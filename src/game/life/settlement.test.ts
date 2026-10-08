import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type BuildingId,
  type ContentSource,
  holderAccount,
  loadContent,
} from "../../core/index.ts";
import {
  BUILDING,
  checkInvariants,
  ENTITY,
  HOUSEHOLD,
  LOCATION,
  materialUnit,
  PERSON,
  SETTLEMENT,
  settlementSpaces,
  WORK,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { createLife } from "./create.ts";
import { Life } from "./life.ts";
import { living } from "./world.ts";

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
const options = { frequency: 8 };

describe("la aldea inicial", () => {
  const life = Life.create(7, content, options);
  const { world, terrain } = life;
  const { truth } = world;

  it("tiene anclas y cada una con causa en el registro", () => {
    const record = truth.get(SETTLEMENT, terrain.population.settlement);
    expect(record?.anchors.length).toBeGreaterThan(0);
    for (const a of record?.anchors ?? []) expect(world.log.get(a.cause)).toBeDefined();
  });

  it("una casa por hogar vivo, con dueño, cuartos y componentes con origen", () => {
    const alive = terrain.population.households.filter((h) => h.end === null);
    const homes = truth.ids(BUILDING).filter((id) => truth.get(BUILDING, id)?.household);
    expect(homes).toHaveLength(alive.length);
    for (const h of alive) {
      const b = homes.map((id) => truth.get(BUILDING, id)).find((x) => x?.household === h.id);
      expect(b?.owner).toBe(h.id);
      expect(b?.components.map((c) => c.part)).toEqual(
        expect.arrayContaining(["foundation", "walls", "roof", "door"]),
      );
      for (const c of b?.components ?? []) {
        expect(c.condition).toBeGreaterThan(0);
        expect(c.condition).toBeLessThanOrEqual(1);
        for (const m of c.materials) expect(world.log.get(m.origin)).toBeDefined();
      }
    }
    expect(truth.ids(BUILDING).length).toBeGreaterThan(alive.length); // y el granero comunal
  });

  it("hay un pozo en la plaza y un camino, de la comunidad", () => {
    const works = truth.ids(WORK).map((id) => truth.get(WORK, id));
    const well = works.find((w) => w?.kind === "well");
    expect(well?.capacity).toBeGreaterThan(0);
    expect(well?.owner).toEqual({ kind: "settlement", settlement: terrain.population.settlement });
    const road = works.find((w) => w?.kind === "road");
    expect(road?.hexes.length).toBeGreaterThan(1);
    expect(road?.hexes[0]).toBe(terrain.site.hex);
  });

  it("los materiales salieron de la fuente declarada y el ledger cierra", () => {
    expect(world.ledger.audit()).toEqual([]);
    const total = truth
      .ids(BUILDING)
      .reduce(
        (sum, id) =>
          sum +
          world.ledger.balance(
            holderAccount({ kind: "building", building: id as BuildingId }),
            materialUnit("stone"),
          ),
        0,
      );
    expect(total).toBeGreaterThan(0);
    expect(checkInvariants({ truth, log: world.log, ledger: world.ledger })).toEqual([]);
  });

  it("el grafo sale de los edificios y cada vivo empieza en un espacio que existe", () => {
    const keys = new Set(world.spaces.spaces.map((s) => s.key));
    for (const id of living(truth)) {
      const at = truth.get(LOCATION, id);
      expect(keys.has(at?.space as string)).toBe(true);
    }
    const again = settlementSpaces(truth, terrain.site.hex);
    expect(again).toEqual(world.spaces);
    const aliveHouseholds = truth
      .ids(HOUSEHOLD)
      .filter((id) => truth.get(ENTITY, id)?.endedAt === undefined);
    expect(world.spaces.spaces.length).toBeGreaterThan(aliveHouseholds.length);
  });

  it("retomar la vida da el mismo grafo desde lo guardado", () => {
    const saved = { ...life.state(), ids: life.world.ids };
    const resumed = Life.resume(7, content, saved, options, life.anchor);
    expect(resumed.world.spaces).toEqual(life.world.spaces);
  }, 120_000);

  it("es determinista: mismo seed, misma aldea y mismo hash", () => {
    expect(Life.create(7, content, options).hash()).toEqual(life.hash());
  }, 120_000);

  it("para cualquier seed: ledger y invariantes cierran, y toda construcción tiene causa", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5000 }), (seed) => {
        const w = createLife(seed, content, options).world;
        expect(w.ledger.audit()).toEqual([]);
        expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
        for (const id of [...w.truth.ids(BUILDING), ...w.truth.ids(WORK)]) {
          const origin = w.truth.get(ENTITY, id)?.originEventId;
          expect(origin && w.log.get(origin)?.causes.length).toBeGreaterThan(0);
        }
        for (const id of w.truth.ids(PERSON)) {
          const b = w.truth
            .ids(BUILDING)
            .find(
              (x) => w.truth.get(BUILDING, x)?.household === w.truth.get(PERSON, id)?.household,
            );
          if (w.truth.get(ENTITY, id)?.endedAt === undefined) expect(b).toBeDefined();
        }
      }),
      { numRuns: 3 },
    );
  }, 300_000);
});
