import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent, makeId } from "../../core/index.ts";
import {
  checkInvariants,
  ENTITY,
  HOUSEHOLD,
  ORG,
  orgViolations,
  PERSON,
  WorldTruth,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { type CouncilOptions, councilProcess, councilRows, inAnyCouncil } from "./council.ts";
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
const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
const DAY = 86400;

function lifeWith(council: boolean) {
  const life = Life.create(3, content, council ? { council: {} } : {});
  life.advanceTo(life.now + DAY * 3);
  return life;
}

describe("life.council: el consejo de aldea sembrado desde sus ancianos", () => {
  it("apagado no existe: sin tabla ORG ni eventos org.*", () => {
    const life = lifeWith(false);
    expect(life.world.truth.ids(ORG)).toHaveLength(0);
    expect(life.world.log.all().some((e) => e.kind.startsWith("org."))).toBe(false);
  });

  it("encendido funda un consejo con origen causal, y el mundo cumple los invariantes", () => {
    const life = lifeWith(true);
    const { truth, log } = life.world;
    const rows = councilRows(truth);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const { id, org } of rows) {
      expect(orgViolations(org)).toEqual([]);
      expect(org.founders.length).toBeGreaterThanOrEqual(2);
      const origin = log.get(org.originEventId);
      expect(origin?.kind).toBe("org.founded");
      expect(truth.get(ENTITY, id as never)?.originEventId).toBe(org.originEventId);
      // la causa del acta es la fundación del asentamiento
      const settled = truth.get(ENTITY, org.settlement as never)?.originEventId;
      expect(JSON.stringify(origin?.causes)).toContain(String(settled));
      for (const m of org.members) {
        const p = truth.get(PERSON, m.agent);
        expect(p).toBeDefined();
        expect((life.now - (p?.born ?? 0)) / (365 * DAY)).toBeGreaterThan(0);
      }
    }
    const first = rows[0]?.org;
    expect(inAnyCouncil(truth, first?.founders[0] ?? ("agent:0" as never))).toBe(true);
    expect(checkInvariants({ truth, log })).toEqual([]);
  });

  it("es determinista: mismo seed y opciones, mismo hash", () => {
    expect(lifeWith(true).hash().total).toBe(lifeWith(true).hash().total);
  });

  it("apagado deja el hash idéntico al de antes de existir la opción (baseline de develop 119c5bc)", () => {
    const life = Life.create(3, content, { legacyNoOscillationEvents: true });
    expect(life.hash().total).toBe(
      "da2346d34cc826ff26aeb0291cc41a5669979152556893116fef734e944199b1",
    );
    life.advanceTo(life.now + DAY * 5);
    expect(life.hash().total).toBe(
      "a62e51db7c5f3e43a59d70950f0d89e6f3d60fc7adaeb2a648967ef885c2fbf1",
    );
    expect(lifeWith(true).hash().total).not.toBe(lifeWith(false).hash().total);
  });
});

describe("life.council: salidas por muerte (proceso aislado)", () => {
  const ag = (n: number) => makeId("agent", n);
  const ev = (n: number) => makeId("event", n);

  function world() {
    const t = new WorldTruth();
    const s = makeId("settlement", 1);
    t.set(ENTITY, s, { id: s, originEventId: ev(1), createdAt: 0 } as never);
    const hid = makeId("household", 1);
    t.set(ENTITY, hid, { id: hid, originEventId: ev(1), createdAt: 0 } as never);
    t.set(HOUSEHOLD, hid, { settlement: s, members: [ag(1), ag(2), ag(3), ag(4)] });
    const ages = [70, 60, 55, 10];
    [1, 2, 3, 4].forEach((n, i) => {
      t.set(ENTITY, ag(n), { id: ag(n), originEventId: ev(1), createdAt: 0 } as never);
      t.set(PERSON, ag(n), { household: hid, born: -(ages[i] ?? 0) * 1000 } as never);
    });
    return t;
  }

  const opts: CouncilOptions = {
    day: 10,
    year: 1000,
    placeOf: () => ({ kind: "cell" }) as never,
  };

  function step(truth: WorldTruth, now: number, n: number, o: CouncilOptions = opts) {
    const p = councilProcess(o);
    let sn = n;
    const r = p.run({
      truth,
      now,
      recent: [],
      rng: undefined,
      newId: () => makeId("org", ++sn),
    } as never);
    for (const c of r.changes ?? []) {
      const x = c as unknown as { table: string; id: never; value: unknown };
      truth.setRaw(x.table, x.id, x.value);
    }
    return r;
  }

  it("funda una sola vez y deja afuera a los jóvenes", () => {
    const t = world();
    const a = step(t, 0, 0);
    expect(a.events?.map((e) => e.kind)).toEqual(["org.founded"]);
    const b = step(t, 10, 5);
    expect(b.events ?? []).toEqual([]);
    const rows = councilRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.org.founders).toEqual([ag(1), ag(2), ag(3)]);
  });

  it("al morir el cabeza, la membresía se cierra con el evento de su muerte y el puesto queda vacante", () => {
    const t = world();
    step(t, 0, 0);
    t.set(ENTITY, ag(1), {
      id: ag(1),
      originEventId: ev(1),
      createdAt: 0,
      endedAt: 50,
      endEventId: ev(9),
    } as never);
    const r = step(t, 60, 5, { ...opts, succession: false });
    expect(r.events?.map((e) => e.kind)).toEqual(["org.member_left"]);
    expect(JSON.stringify(r.events?.[0]?.causes)).toContain(String(ev(9)));
    const org = councilRows(t)[0]?.org;
    expect(org?.positions[0]?.holder).toBeNull();
    expect(org?.members.find((m) => m.agent === ag(1))?.until).toBe(50);
    expect(orgViolations(org as never)).toEqual([]);
    expect(step(t, 70, 5, { ...opts, succession: false }).events ?? []).toEqual([]);
  });
});
