import { describe, expect, it } from "vitest";
import { EARTHLIKE_CLOCK, EventLog, IdAllocator, Ledger, makeId, Rng } from "../../core/index.ts";
import {
  BUILDING,
  createEntity,
  draftEvent,
  ENTITY,
  type GoodDef,
  type OscillationYear,
  PERSON,
  PRESSURE,
  type ProcessDef,
  Scheduler,
  WorldTruth,
} from "../../sim/index.ts";
import { FAMINE, famineProcess } from "./famine.ts";

const clock = EARTHLIKE_CLOCK;
const settlement = makeId("settlement", 1);
const person = makeId("agent", 1);
const house = makeId("building", 1);
const place = { kind: "settlement", settlement } as const;
const goods = [
  { id: "grain", name: "grano", form: "good", priceCopperPerKg: 4, halfLifeDays: 400 },
] as unknown as GoodDef[];

function world(oscillationYear?: (day: number) => OscillationYear | undefined) {
  const truth = new WorldTruth();
  const log = new EventLog();
  const origin = makeId("event", 1);
  log.append({
    id: origin,
    tick: 0,
    kind: "seed",
    actors: [],
    place,
    data: {},
    emissions: {},
    causes: [{ kind: "seed" }],
    resolution: "local",
  });
  for (const id of [settlement, person, house])
    truth.set(ENTITY, id, { id, createdAt: 0, originEventId: origin });
  truth.setRaw(PERSON.name, person, { born: -30 * clock.year, household: "household:1" });
  truth.setRaw(BUILDING.name, house, { household: "household:1", settlement });
  const concurrent: ProcessDef = {
    id: "test.other_entity",
    system: "test",
    scope: "world",
    cadence: { local: "day" },
    representation: "individual",
    phase: "act",
    reads: [],
    writes: [ENTITY.name],
    run(ctx) {
      const id = ctx.newId("item");
      return {
        changes: [createEntity(id, draftEvent(0), ctx.now)],
        events: [
          {
            kind: "test.created",
            actors: [id],
            place,
            data: {},
            emissions: {},
            causes: [{ kind: "seed" }],
          },
        ],
      };
    },
  };
  const scheduler = new Scheduler({
    truth,
    log,
    ids: new IdAllocator({ event: 2, agent: 2, building: 2, settlement: 2 }),
    rng: Rng.root(7),
    clock,
    ledger: new Ledger({ externals: {} }),
    resolution: "local",
    processes: [
      famineProcess({
        clock,
        goods,
        staple: "grain",
        placeOf: () => place,
        ...(oscillationYear ? { oscillationYear } : {}),
      }),
      concurrent,
    ],
  });
  return { truth, log, scheduler };
}

describe("life.famine con scheduler real", () => {
  it("crea y cita la presión con origen, junto a otro creador de entidades en act", () => {
    const w = world();
    expect(() => w.scheduler.advanceTo(clock.day)).not.toThrow();
    expect(w.truth.get(FAMINE, settlement)?.state).toBe("famine");
    const pressure = w.truth.ids(PRESSURE)[0];
    expect(pressure).toBeDefined();
    if (!pressure) return;
    const event = w.log.all().find((e) => e.kind === "famine.worsened");
    expect(event).toBeDefined();
    expect(w.truth.get(ENTITY, pressure)?.originEventId).toBe(event?.id);
    expect(event?.causes).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "pressure", pressure })]),
    );
    expect(w.log.all().some((e) => e.kind === "test.created")).toBe(true);
    w.scheduler.advanceTo(2 * clock.day);
    expect(w.truth.ids(PRESSURE)).toEqual([pressure]);
  });

  it("mismo seed conserva verdad y eventos", () => {
    const a = world();
    const b = world();
    a.scheduler.advanceTo(2 * clock.day);
    b.scheduler.advanceTo(2 * clock.day);
    expect(a.truth.rows()).toEqual(b.truth.rows());
    expect(a.log.all()).toEqual(b.log.all());
  });
});

describe("la hambruna cita la oscilación (life-34)", () => {
  const dry = (day: number): OscillationYear => ({
    cause: { basin: "basin-9", year: Math.floor(day / 365), phase: "cool", value: -0.8 },
    teleconnection: 0.7,
    precipFactor: 0.6,
    effect: "dry",
  });

  it("un año seco queda en las causas y en los datos del evento", () => {
    const w = world(dry);
    w.scheduler.advanceTo(clock.day);
    const event = w.log.all().find((e) => e.kind === "famine.worsened");
    expect(event?.causes).toContainEqual({
      kind: "state",
      entity: settlement,
      key: "oscillation:basin-9:0:cool",
    });
    expect(event?.data).toMatchObject({ oscillation: { basin: "basin-9", phase: "cool" } });
  });

  it("sin año seco, o sin la opción, no cita nada", () => {
    const wet = (day: number): OscillationYear => ({
      ...dry(day),
      precipFactor: 1.3,
      effect: "wet",
    });
    for (const w of [world(wet), world()]) {
      w.scheduler.advanceTo(clock.day);
      const event = w.log.all().find((e) => e.kind === "famine.worsened");
      expect(event).toBeDefined();
      expect(event?.data).not.toHaveProperty("oscillation");
      expect(JSON.stringify(event?.causes)).not.toContain("oscillation:");
    }
  });

  it("es determinista", () => {
    const a = world(dry);
    const b = world(dry);
    a.scheduler.advanceTo(2 * clock.day);
    b.scheduler.advanceTo(2 * clock.day);
    expect(a.log.all()).toEqual(b.log.all());
  });
});
