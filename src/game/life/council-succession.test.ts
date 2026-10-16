import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent, makeId } from "../../core/index.ts";
import {
  activeMembers,
  checkInvariants,
  ENTITY,
  HOUSEHOLD,
  type Organization,
  orgViolations,
  PERSON,
  RELATIONS,
  WorldTruth,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { type CouncilOptions, councilProcess, councilRows } from "./council.ts";
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

const ag = (n: number) => makeId("agent", n);
const ev = (n: number) => makeId("event", n);
const opts: CouncilOptions = { day: 10, year: 1000, placeOf: () => ({ kind: "cell" }) as never };

function world(ages: number[]) {
  const t = new WorldTruth();
  const s = makeId("settlement", 1);
  t.set(ENTITY, s, { id: s, originEventId: ev(1), createdAt: 0 } as never);
  const hid = makeId("household", 1);
  t.set(ENTITY, hid, { id: hid, originEventId: ev(1), createdAt: 0 } as never);
  const ids = ages.map((_, i) => ag(i + 1));
  t.set(HOUSEHOLD, hid, { settlement: s, members: ids });
  ids.forEach((id, i) => {
    t.set(ENTITY, id, { id, originEventId: ev(1), createdAt: 0 } as never);
    t.set(PERSON, id, { household: hid, born: -(ages[i] ?? 0) * 1000 } as never);
  });
  return t;
}

let nid = 0;
function step(truth: WorldTruth, now: number, o: CouncilOptions = opts) {
  const r = councilProcess(o).run({
    truth,
    now,
    recent: [],
    rng: undefined,
    newId: () => makeId("org", ++nid),
  } as never);
  for (const c of r.changes ?? []) {
    const x = c as unknown as { table: string; id: never; value: unknown };
    truth.setRaw(x.table, x.id, x.value);
  }
  return r;
}

const kill = (t: WorldTruth, n: number, at: number, e: number) =>
  t.set(ENTITY, ag(n), {
    id: ag(n),
    originEventId: ev(1),
    createdAt: 0,
    endedAt: at,
    endEventId: ev(e),
  } as never);

describe("life.council: sucesión y reposición (proceso aislado)", () => {
  it("al morir el cabeza lo releva el miembro con más legitimidad, con la muerte como causa", () => {
    const t = world([70, 60, 55, 50, 46, 45]);
    step(t, 0);
    kill(t, 1, 50, 9);
    const r = step(t, 60);
    expect(r.events?.map((e) => e.kind)).toEqual([
      "org.member_left",
      "org.position_filled",
      "org.member_joined",
    ]);
    expect(JSON.stringify(r.events?.[1]?.causes)).toContain(String(ev(9)));
    const org = councilRows(t)[0]?.org as Organization;
    expect(org.positions[0]?.holder).toBe(ag(2));
    expect(org.members.find((m) => m.agent === ag(2))?.rank).toBe("head");
    expect(orgViolations(org)).toEqual([]);
  });

  it("repone el asiento solo si lo dejó una muerte y hay un candidato con edad", () => {
    const t = world([70, 60, 55, 50, 46, 30]);
    step(t, 0); // asientos 1-5; el 6 es joven
    expect(step(t, 5).events ?? []).toEqual([]);
    kill(t, 3, 50, 8);
    expect(step(t, 60).events?.map((e) => e.kind)).toEqual(["org.member_left"]);
    t.set(PERSON, ag(6), { household: makeId("household", 1), born: -50 * 1000 } as never);
    const r2 = step(t, 70);
    expect(r2.events?.map((e) => e.kind)).toEqual(["org.member_joined"]);
    expect(JSON.stringify(r2.events?.[0]?.causes)).toContain(String(ev(8)));
    const org = councilRows(t)[0]?.org as Organization;
    expect(org.members.find((m) => m.agent === ag(6))?.via).toBe("coopted");
    expect(orgViolations(org)).toEqual([]);
    expect(step(t, 80).events ?? []).toEqual([]);
  });

  it("el respeto de RELATIONS inclina la sucesión", () => {
    const t = world([70, 62, 60, 58]);
    const o: CouncilOptions = { ...opts, respect: "relations" };
    step(t, 0, o);
    for (const n of [2, 4])
      t.set(RELATIONS, ag(n), {
        originEventId: ev(1),
        toward: { [ag(3) as string]: { dims: { respect: 1 } } },
      } as never);
    kill(t, 1, 50, 9);
    step(t, 60, o);
    expect(councilRows(t)[0]?.org.positions[0]?.holder).toBe(ag(3));
  });

  it("sin succession no releva ni repone", () => {
    const t = world([70, 60, 55, 50, 46]);
    step(t, 0);
    kill(t, 1, 50, 9);
    step(t, 60, { ...opts, succession: false });
    expect(councilRows(t)[0]?.org.positions[0]?.holder).toBeNull();
  });

  it("fast-check: tras cualquier cadena de muertes el consejo cumple sus reglas y es determinista", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 20, max: 85 }), { minLength: 4, maxLength: 12 }),
        fc.array(fc.integer({ min: 0, max: 11 }), { maxLength: 8 }),
        (ages, deaths) => {
          const run = () => {
            nid = 0;
            const t = world(ages);
            step(t, 0);
            let now = 10;
            let e = 20;
            for (const d of deaths) {
              if (d < ages.length) kill(t, d + 1, now, e++);
              now += 10;
              step(t, now);
            }
            return councilRows(t).map((r) => r.org);
          };
          const a = run();
          expect(JSON.stringify(run())).toBe(JSON.stringify(a));
          for (const org of a) {
            expect(orgViolations(org)).toEqual([]);
            expect(activeMembers(org).length).toBeLessThanOrEqual(5);
            if (org.status === "active") expect(org.positions[0]?.holder).not.toBeNull();
          }
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe("life.council: sucesión en la vida", () => {
  it("con consejo y respeto de RELATIONS, los eventos de sucesión tienen causa y se cumplen los invariantes", () => {
    const life = Life.create(3, content, { council: { respect: "relations" } });
    life.advanceTo(life.now + DAY * 30);
    const { truth, log } = life.world;
    for (const { org } of councilRows(truth)) expect(orgViolations(org)).toEqual([]);
    for (const e of log.all().filter((x) => x.kind === "org.position_filled"))
      expect(e.causes.length).toBeGreaterThan(0);
    expect(checkInvariants({ truth, log })).toEqual([]);
  });
});
