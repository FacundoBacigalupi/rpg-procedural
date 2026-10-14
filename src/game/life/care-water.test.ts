import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EARTHLIKE_CLOCK as clock,
  EventLog,
  IdAllocator,
  Ledger,
  loadContent,
  makeId,
  Rng,
} from "../../core/index.ts";
import {
  BODY_PLANS,
  BODY_STATE,
  ENTITY,
  type FoodDef,
  INNATE,
  LOCATION,
  type LocalMap,
  newBody,
  PERSON,
  PLACE,
  Scheduler,
  WorldTruth,
} from "../../sim/index.ts";
import { routineProcess } from "./routine.ts";

const file = "content/body-plans/human.json";
const plans = loadContent(
  [BODY_PLANS],
  [{ kind: "body-plans", file, data: JSON.parse(readFileSync(file, "utf8")) }],
).all(BODY_PLANS);
const home = makeId("household", 1);
const foods = [{ id: "grain", name: "grano", kcalPerGram: 3.6, waterPerGram: 0 }] as FoodDef[];
const map: LocalMap = {
  cell: makeId("cell", 1),
  lonDeg: 180,
  neighbors: [[]],
  crossSeconds: [1],
  forest: [false],
  climate: {
    cell: "cell:1",
    latDeg: 0,
    axialTiltDeg: 23,
    annualMeanC: 20,
    seasonalRangeC: 5,
    annualPrecipMm: 800,
    windEast: 1,
    windNorth: 0,
  },
};
const sick = makeId("agent", 1);
const carer = makeId("agent", 2);

/** Un inconsciente con 2 L de déficit y, según el caso, alguien que lo cuide. */
function world(opts: { careWater: boolean; carerAgeYears?: number; carerHex?: number }) {
  const truth = new WorldTruth();
  const log = new EventLog();
  const place = { kind: "cell", cell: map.cell } as const;
  log.append({
    id: makeId("event", 1),
    tick: 0,
    kind: "seed",
    actors: [],
    place,
    data: {},
    emissions: {},
    causes: [{ kind: "seed" }],
    resolution: "local",
  });
  const plan = plans[0];
  if (!plan) throw new Error("sin body plan");
  truth.setRaw(PLACE.name, makeId("place", 1), { name: "aldea", kind: "village", hexes: [0, 1] });
  const people = [
    { id: sick, age: 30, hex: 0 },
    ...(opts.carerAgeYears === undefined
      ? []
      : [{ id: carer, age: opts.carerAgeYears, hex: opts.carerHex ?? 0 }]),
  ];
  for (const p of people) {
    truth.set(ENTITY, p.id, { id: p.id, createdAt: 0, originEventId: makeId("event", 1) });
    truth.setRaw(PERSON.name, p.id, {
      born: -p.age * clock.year,
      sex: "male",
      household: home,
    });
    const body = newBody(plan, 55, 0);
    truth.set(
      BODY_STATE,
      p.id,
      p.id === sick ? { ...body, consciousness: "unconscious", water: 2 } : body,
    );
    truth.set(LOCATION, p.id, { hex: p.hex });
    truth.set(INNATE, p.id, {});
  }
  const scheduler = new Scheduler(
    {
      truth,
      log,
      ledger: new Ledger({ externals: {} }),
      clock,
      rng: Rng.root(7),
      ids: new IdAllocator({ event: 2, agent: 3 }),
      resolution: "local",
      scopes: (kind) => (kind === "agent" ? truth.ids(PERSON) : ["world"]),
      processes: [
        routineProcess({
          ...(opts.careWater ? { careWater: true } : {}),
          map,
          spaces: { spaces: [], edges: [] },
          bodyPlans: plans,
          foods,
          clock,
          seed: 7,
          placeOf: () => place,
        }),
      ],
    },
    { now: clock.day - 3600, seq: 0, queue: [] },
  );
  return { truth, log, scheduler };
}

function run(opts: Parameters<typeof world>[0]) {
  const w = world(opts);
  w.scheduler.advanceTo(clock.day * 2);
  const watered = w.log.all().filter((e) => e.kind === "routine.watered");
  const water = w.truth.get(BODY_STATE, sick)?.water ?? 0;
  return { watered, water, w };
}

describe("cuidar al inconsciente: agua del cuidador (life-13)", () => {
  it("un adulto de la casa en el mismo hex le da de beber a las horas de agua", () => {
    const { watered, water } = run({ careWater: true, carerAgeYears: 30 });
    expect(watered.length).toBeGreaterThan(0);
    expect(watered.every((e) => e.actors[0] === carer && e.actors[1] === sick)).toBe(true);
    expect(water).toBeLessThan(2);
  });
  it("sin la opción, nadie lo atiende (el motor anterior)", () => {
    const { watered, water } = run({ careWater: false, carerAgeYears: 30 });
    expect(watered).toHaveLength(0);
    expect(water).toBeGreaterThanOrEqual(2);
  });
  it("sin cuidador, un chico o alguien en otro hex, sigue sin beber", () => {
    expect(run({ careWater: true }).watered).toHaveLength(0);
    expect(run({ careWater: true, carerAgeYears: 8 }).watered).toHaveLength(0);
    expect(run({ careWater: true, carerAgeYears: 30, carerHex: 1 }).watered).toHaveLength(0);
  });
  it("es determinista", () => {
    const a = run({ careWater: true, carerAgeYears: 30 });
    const b = run({ careWater: true, carerAgeYears: 30 });
    expect(a.w.truth.rows()).toEqual(b.w.truth.rows());
    expect(a.w.log.all()).toEqual(b.w.log.all());
  });
});
