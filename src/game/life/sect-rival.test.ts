// La secta rival (novel4-rival-sect-seed): con `rivalSect`, una segunda secta al alcance de la
// aldea, en otra sede (ni la de la primera ni sus vecinas), con su fundación, plazas y escuela.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, type EntityRef, HOUR, loadContent } from "../../core/index.ts";
import {
  checkInvariants,
  chooseRivalSeat,
  ENTITY,
  isRival,
  LOCATION,
  ORG_RELATION,
  ORG_RIVALRY_EVENT,
  PLACE,
  PLACE_NAME,
  PLACE_QI,
  patchOf,
  SECT,
  SECT_FOUNDED_EVENT,
  SECT_LORE,
  SECT_MEMBER,
  SECT_SCHOOL,
  SECTS_HEARD,
  WILDS,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { knownEntities } from "./known.ts";
import { Life } from "./life.ts";
import { SECT_HALL } from "./sect-hall.ts";

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}

describe("la sede de la secta rival (novel4-rival-sect-seed)", () => {
  it("la mejor candidata que no está tomada", () => {
    const c = (cell: number, level: number) => ({ cell, hops: 1, level, land: true });
    const all = [c(1, 9), c(2, 8), c(3, 7)];
    expect(chooseRivalSeat(all, new Set([1, 2]))?.cell).toBe(3);
    expect(chooseRivalSeat(all, new Set([1, 2, 3]))).toBeUndefined();
  });
});

describe("la secta rival en la vida (novel4-rival-sect-seed)", () => {
  const content = loadContent(GAME_CONTENT_KINDS, sources("content"));

  it("con la opción hay dos sectas en sedes distintas, cada una con su fundación; determinista", () => {
    const l = Life.create(3, content, { cultivation: true, rivalSect: true });
    const t = l.world.truth;
    const orgs = t.ids(SECT) as EntityRef[];
    expect(orgs.length).toBe(2);
    const [a, b] = orgs.map((o) => t.get(SECT, o));
    if (!a || !b) throw new Error("sin sectas");
    expect(a.seat.cell).not.toBe(b.seat.cell);
    expect(a.seatPlace).not.toBe(b.seatPlace);
    expect(a.originEventId).not.toBe(b.originEventId);
    for (const o of orgs) {
      const s = t.get(SECT, o);
      expect(t.get(ENTITY, o)?.originEventId).toBe(s?.originEventId);
      expect(t.has(SECT_SCHOOL, o)).toBe(true);
      expect(t.has(PLACE_NAME, s?.seatPlace as EntityRef)).toBe(true);
    }
    const founded = l.world.log.all().filter((e) => e.kind === SECT_FOUNDED_EVENT);
    expect(founded.length).toBe(2);
    // La rival no baja a la aldea todavía (novel4-recruit).
    expect(b.visitDay).toBeUndefined();
    const twin = Life.create(3, content, { cultivation: true, rivalSect: true });
    expect(twin.hash().total).toBe(l.hash().total);
  });

  it("sin la opción, una sola secta y el mismo mundo", () => {
    const off = Life.create(3, content, { cultivation: true });
    expect(off.world.truth.ids(SECT).length).toBe(1);
    const explicit = Life.create(3, content, { cultivation: true, rivalSect: false });
    expect(explicit.hash().total).toBe(off.hash().total);
  });
});

describe("la sede rival en la región (novel4-rival-sect-region)", () => {
  const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
  const options = { cultivation: true, sectSeatRegion: true, rivalSect: true } as const;
  const run = () => {
    const l = Life.create(3, content, options);
    const w = l.world;
    const [first, rival] = w.truth.ids(SECT) as EntityRef[];
    const a = first ? w.truth.get(SECT, first) : undefined;
    const b = rival ? w.truth.get(SECT, rival) : undefined;
    if (!a || !b || !rival) throw new Error("sin sectas");
    const hexA = w.truth.get(PLACE, a.seatPlace)?.hexes[0];
    const hexB = w.truth.get(PLACE, b.seatPlace)?.hexes[0];
    if (hexA === undefined || hexB === undefined) throw new Error("sedes fuera del mapa");
    return { l, w, rival, b, hexA, hexB };
  };

  it("las dos sedes están en el mapa, cada una en su parche, con su qi y su monte", () => {
    const { l, w, b, hexA, hexB } = run();
    const map = l.world.map;
    expect(patchOf(map, hexA).base).not.toBe(patchOf(map, hexB).base);
    expect(w.truth.get(PLACE_QI, b.seatPlace)).toEqual(b.seat.qi);
    expect(w.truth.has(WILDS, b.seatPlace)).toBe(true);
  });

  it("al llegar a su sede, su gente está ahí, de su secta; determinista", () => {
    const go = () => {
      const r = run();
      r.w.truth.set(LOCATION, r.l.player, { hex: r.hexB });
      r.l.advanceTo(r.l.now + 2 * HOUR);
      return r;
    };
    const { l, w, rival, hexB } = go();
    const people = w.truth.get(SECT_HALL, rival)?.people ?? [];
    expect(people.length).toBeGreaterThan(0);
    const base = patchOf(l.world.map, hexB).base;
    for (const x of people) {
      expect(w.truth.get(SECT_MEMBER, x.person)?.org).toBe(rival);
      const hex = w.truth.get(LOCATION, x.person)?.hex as number;
      expect(patchOf(l.world.map, hex).base).toBe(base);
    }
    expect(checkInvariants({ truth: w.truth, log: w.log })).toEqual([]);
    expect(go().l.hash().total).toBe(l.hash().total);
  });
});

describe("la rivalidad entre las dos (novel4-rival-sect-relation)", () => {
  const content = loadContent(GAME_CONTENT_KINDS, sources("content"));

  it("cada una tiene a la otra por rival, con lo que cree de ella y un origen; determinista", () => {
    const l = Life.create(3, content, { cultivation: true, rivalSect: true });
    const t = l.world.truth;
    const [a, b] = t.ids(SECT) as EntityRef[];
    if (!a || !b) throw new Error("sin sectas");
    const born = l.world.log.all().filter((e) => e.kind === ORG_RIVALRY_EVENT);
    expect(born.length).toBe(1);
    const ev = born[0];
    const founded = [t.get(SECT, a), t.get(SECT, b)].map((s) => s?.originEventId);
    expect(ev?.causes.map((c) => (c.kind === "event" ? c.event : undefined)).sort()).toEqual(
      [...founded].sort(),
    );
    for (const [from, to] of [
      [a, b],
      [b, a],
    ] as const) {
      const rel = t.get(ORG_RELATION, from);
      expect(isRival(rel, to)).toBe(true);
      const tie = rel?.toward[to];
      expect(tie?.originEventId).toBe(ev?.id);
      expect(tie?.grievances).toEqual([]);
      expect(tie?.believedStrength.elders).toBeGreaterThan(0);
    }
    expect(checkInvariants({ truth: t, log: l.world.log })).toEqual([]);
    const twin = Life.create(3, content, { cultivation: true, rivalSect: true });
    expect(twin.world.truth.get(ORG_RELATION, a)).toEqual(t.get(ORG_RELATION, a));
  });

  it("sin la opción, ninguna relación", () => {
    const l = Life.create(3, content, { cultivation: true });
    expect(l.world.truth.ids(ORG_RELATION)).toEqual([]);
  });
});

describe("lo que la aldea oyó de la otra secta (novel4-rival-sect-lore)", () => {
  const content = loadContent(GAME_CONTENT_KINDS, sources("content"));

  it("algunos la oyeron nombrar, menos que a la que baja; la creencia apunta a su sede", () => {
    const l = Life.create(3, content, { cultivation: true, rivalSect: true });
    const t = l.world.truth;
    const [a, b] = t.ids(SECT) as EntityRef[];
    const rival = b ? t.get(SECT, b) : undefined;
    if (!a || !b || !rival) throw new Error("sin sectas");
    const first = t.ids(SECT_LORE).length;
    const heard = t.ids(SECTS_HEARD) as EntityRef[];
    expect(heard.length).toBeGreaterThan(0);
    expect(heard.length).toBeLessThan(first);
    for (const id of heard) {
      const lore = t.get(SECTS_HEARD, id)?.toward[b];
      expect(lore?.seat).toBe(rival.seatPlace);
      expect(t.get(SECT_LORE, id)?.org ?? a).toBe(a);
    }
  });

  it("si el personaje la oyó, la nombra como «la otra secta»", () => {
    const l = Life.create(3, content, { cultivation: true, rivalSect: true });
    const t = l.world.truth;
    const b = (t.ids(SECT) as EntityRef[])[1] as EntityRef;
    const rival = t.get(SECT, b);
    if (!rival) throw new Error("sin rival");
    const someone = (t.ids(SECTS_HEARD) as EntityRef[])[0] as EntityRef;
    const lore = t.get(SECTS_HEARD, someone)?.toward[b];
    if (!lore) throw new Error("nadie la oyó");
    t.set(SECTS_HEARD, l.player, { toward: { [b]: lore } });
    const k = knownEntities(l.world).find((x) => x.ref === rival.seatPlace);
    expect(k?.names).toContain("la otra secta");
    expect(k?.names).not.toContain("la secta");
  });
});
