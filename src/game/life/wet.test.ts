import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, loadContent, type Tick } from "../../core/index.ts";
import {
  checkInvariants,
  LOCATION,
  PERSON,
  type ThermalEnv,
  WorldTruth,
  weatherAt,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";
import {
  DRY_FIRE_PER_HOUR,
  DRY_INDOOR_PER_HOUR,
  FORD_WET,
  fordOf,
  outdoorDrying,
  WADED_EVENT,
  WET_CLOTHES,
  WET_LAST_HEX,
  WET_PER_HOUR,
  wetAfter,
  wetClothesProcess,
  wetEnv,
} from "./wet.ts";

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
const DAY = 86_400;
const HOUR = 3_600;

const rain = { kind: "rain", mm: 20 } as const;
const dry = { kind: "none", mm: 0 } as const;
const base = { airC: 10, windMs: 0, fire: 0 };

describe("la ropa mojada (clothing-wet)", () => {
  it("afuera con lluvia se moja según lo que cae; la nieve moja menos; adentro no", () => {
    expect(wetAfter(0, 1, { ...base, outdoors: true, precip: rain })).toBeCloseTo(WET_PER_HOUR, 6);
    expect(
      wetAfter(0, 1, { ...base, outdoors: true, precip: { kind: "rain", mm: 2 } }),
    ).toBeLessThan(WET_PER_HOUR);
    expect(
      wetAfter(0, 1, { ...base, outdoors: true, precip: { kind: "snow", mm: 20 } }),
    ).toBeLessThan(WET_PER_HOUR);
    expect(wetAfter(0, 5, { ...base, outdoors: true, precip: rain })).toBe(1);
    expect(wetAfter(0, 1, { ...base, outdoors: false, precip: rain })).toBe(0);
  });

  it("se seca despacio adentro, rápido junto al fuego y afuera según el aire y el viento", () => {
    expect(wetAfter(1, 1, { ...base, outdoors: false, precip: rain })).toBeCloseTo(
      1 - DRY_INDOOR_PER_HOUR,
      6,
    );
    expect(wetAfter(1, 1, { ...base, outdoors: false, precip: rain, fire: 1 })).toBeCloseTo(
      1 - DRY_INDOOR_PER_HOUR - DRY_FIRE_PER_HOUR,
      6,
    );
    expect(outdoorDrying(25, 6)).toBeGreaterThan(outdoorDrying(25, 0));
    expect(outdoorDrying(25, 0)).toBeGreaterThan(outdoorDrying(5, 0));
    expect(outdoorDrying(-10, 10)).toBe(0);
    expect(wetAfter(0.2, 10, { ...base, outdoors: false, precip: dry, fire: 1 })).toBe(0);
  });

  it("la ropa mojada moja el ambiente térmico de quien la lleva", () => {
    const truth = new WorldTruth();
    const who = "agent:1" as AgentId;
    const env = { wet: 0 } as unknown as ThermalEnv;
    expect(wetEnv(truth, who, env)).toBe(env);
    truth.set(WET_CLOTHES, who, { wet: 0.6 });
    expect(wetEnv(truth, who, env).wet).toBe(0.6);
  });

  it("en la vida quien está afuera con lluvia se moja; determinista, auditoría e invariantes limpios", () => {
    const run = () => {
      const life = Life.create(42, content, { frequency: 8, wardrobe: true });
      const w = life.world;
      // Con la seed 42 llueve los días 2 y 3 (7 y 10 mm).
      const start = life.now;
      let rainyHours = 0;
      let wetSeen = 0;
      for (let t = start + HOUR; t <= start + 4 * DAY; t += 3 * HOUR) {
        life.advanceTo(t);
        if (weatherAt(w.map, w.clock, w.seed, t as Tick).precip.kind !== "none") rainyHours++;
        wetSeen += w.truth
          .ids(PERSON)
          .filter((id) => w.truth.get(WET_CLOTHES, id as AgentId)).length;
      }
      expect(w.ledger.audit()).toEqual([]);
      expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
      return { rainyHours, wetSeen, hash: life.hash() };
    };
    const a = run();
    expect(a.rainyHours).toBeGreaterThan(0);
    expect(a.wetSeen).toBeGreaterThan(0);
    expect(run()).toEqual(a);
  }, 600_000);
});

describe("vadear ríos (clothing-wet-river)", () => {
  // Cuatro hexes en fila: seco, río, seco, aldea (con un arroyo adentro, que tiene sus pasos).
  const life = Life.create(42, content, { frequency: 8, wardrobe: true });
  const real = life.world.map;
  const map = {
    ...real,
    neighbors: [[1], [0, 2], [1, 3], [2]],
    crossSeconds: [1000, 1000, 1000, 1000],
    forest: [false, false, false, false],
    water: [0, 2, 0, 1],
  };
  const spaces = {
    spaces: [
      {
        key: "home",
        kind: "house",
        hex: 3,
        area: 20,
        indoor: true,
        daylight: 0,
        lamp: 0,
        noise: 0,
        clearSight: 1,
      },
    ],
    edges: [],
  } as never;
  const settled = new Set([3]);

  it("el mapa real trae el agua de cada hex", () => {
    expect(real.water?.length).toBe(real.neighbors.length);
  });

  it("cruzar el río empapa; el agua de la aldea y el hex de salida no cuentan", () => {
    expect(fordOf(map, 0, 2, settled)).toEqual({ hex: 1, wet: FORD_WET[2] });
    expect(fordOf(map, 1, 2, settled)).toBeUndefined();
    expect(fordOf(map, 2, 3, settled)).toBeUndefined();
    expect(fordOf(real.water ? { ...real, water: [] } : real, 0, 2, settled)).toBeUndefined();
  });

  it("el proceso moja a quien vadeó, con su evento, y recuerda dónde lo vio", () => {
    const truth = new WorldTruth();
    const who = "agent:9" as AgentId;
    const someone = life.world.truth.ids(PERSON)[0] as AgentId;
    truth.set(PERSON, who, life.world.truth.get(PERSON, someone) as never);
    truth.set(LOCATION, who, { hex: 2 });
    truth.set(WET_LAST_HEX, who, { hex: 0 });
    const p = wetClothesProcess({
      map,
      clock: life.world.clock,
      seed: life.world.seed,
      spaces,
      ford: { placeOf: () => ({ kind: "cell", cell: map.cell }) },
    });
    const out = p.run({ truth, now: life.now, window: HOUR } as never) as unknown as {
      events?: { kind: string; data: { hex: number } }[];
      changes?: { table: string; value?: { wet?: number; hex?: number } }[];
    };
    expect(out.events?.map((e) => [e.kind, e.data.hex])).toEqual([[WADED_EVENT, 1]]);
    const wet = out.changes?.find((c) => c.table === WET_CLOTHES.name)?.value?.wet ?? 0;
    expect(wet).toBeGreaterThanOrEqual(FORD_WET[2] as number);
    expect(out.changes?.find((c) => c.table === WET_LAST_HEX.name)?.value?.hex).toBe(2);
  });
});
