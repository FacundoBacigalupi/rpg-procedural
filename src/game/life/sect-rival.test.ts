// La secta rival (novel4-rival-sect-seed): con `rivalSect`, una segunda secta al alcance de la
// aldea, en otra sede (ni la de la primera ni sus vecinas), con su fundación, plazas y escuela.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, type EntityRef, loadContent } from "../../core/index.ts";
import {
  chooseRivalSeat,
  ENTITY,
  PLACE_NAME,
  SECT,
  SECT_FOUNDED_EVENT,
  SECT_SCHOOL,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";

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
