import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type AgentId, type EntityRef, EventLog, makeId } from "../../core/index.ts";
import type { PressureScope } from "../causality/index.ts";
import {
  addSpark,
  citePressure,
  findPressure,
  SPARKS,
  type Spark,
  sparkOf,
  sparkStrength,
} from "../causality/index.ts";
import { checkInvariants, ENTITY, PRESSURE, WorldTruth } from "../world/index.ts";
import { draftEvent } from "./index.ts";
import { DAY, def, here, PROCESSES, VILLAGE, village } from "./village.fixture.ts";

const seeds = fc.nat({ max: 0xffffffff });
const scopeOf = (ref: EntityRef): PressureScope => ({ kind: "agent", ref });

/** Cada día, cada vivo descarga su "hambre" (valor fijo por id) citando la presión. */
const starve = def(
  "demo.starve",
  (ctx) => {
    const me = ctx.scope as AgentId;
    if (!ctx.rng.chance(0.5)) return {};
    const value = (Number(me.split(":")[1]) % 10) / 10;
    const ate = draftEvent(0);
    const cite = citePressure(ctx, { kind: "hunger", scope: scopeOf(me), value }, ate);
    return {
      events: [
        {
          kind: "raid",
          actors: [me],
          place: here,
          data: null,
          emissions: {},
          causes: [cite.cause, { kind: "state", entity: me, key: "larder" }],
        },
      ],
      changes: cite.changes,
    };
  },
  { phase: "act", writes: ["entity", PRESSURE.name] },
);

const world = (seed: number) => village(seed, [...PROCESSES, starve]);

describe("citar presiones", () => {
  it("la presión nace del primer evento que la cita y las demás la cuentan", () => {
    fc.assert(
      fc.property(seeds, (seed) => {
        const w = world(seed);
        w.scheduler.advanceTo(60 * DAY);
        expect(checkInvariants(w)).toEqual([]);
        for (const id of w.truth.ids(PRESSURE)) {
          const r = w.truth.get(PRESSURE, id);
          const origin = w.log.get(w.truth.get(ENTITY, id)?.originEventId as never);
          const citing = w.log
            .all()
            .filter((e) => e.causes.some((c) => c.kind === "pressure" && c.pressure === id));
          expect(origin?.id).toBe(citing[0]?.id);
          expect(r?.discharges).toBe(citing.length);
          expect(r?.lastDischarge).toBe(citing.at(-1)?.id);
        }
      }),
      { numRuns: 15 },
    );
  });

  it("una presión por tipo y alcance, aunque se la cite muchas veces", () => {
    const w = world(7);
    w.scheduler.advanceTo(120 * DAY);
    const keys = w.truth.ids(PRESSURE).map((id) => {
      const r = w.truth.get(PRESSURE, id);
      return `${r?.kind}@${r?.scope}`;
    });
    expect(keys.length).toBeGreaterThan(0);
    expect(new Set(keys).size).toBe(keys.length);
    const citedMany = w.truth
      .ids(PRESSURE)
      .some((id) => (w.truth.get(PRESSURE, id)?.discharges ?? 0) > 1);
    expect(citedMany).toBe(true);
  });

  it("cada causa trae el valor del momento", () => {
    const w = world(11);
    w.scheduler.advanceTo(40 * DAY);
    for (const e of w.log.all()) {
      for (const c of e.causes) {
        if (c.kind !== "pressure") continue;
        const who = e.actors[0] as AgentId;
        expect(c.weight).toBe((Number(who.split(":")[1]) % 10) / 10);
      }
    }
  });

  it("es determinista: mismo seed, misma verdad y mismo registro", () => {
    const a = world(3);
    const b = world(3);
    a.scheduler.advanceTo(50 * DAY);
    b.scheduler.advanceTo(50 * DAY);
    expect(a.log.all()).toEqual(b.log.all());
    expect(a.truth.rows()).toEqual(b.truth.rows());
  });

  it("findPressure encuentra por tipo y alcance", () => {
    const w = world(5);
    w.scheduler.advanceTo(30 * DAY);
    const [id] = w.truth.ids(PRESSURE);
    const r = w.truth.get(PRESSURE, id as EntityRef);
    expect(findPressure(w.truth, "hunger", scopeOf(r?.scope as EntityRef))).toBe(id);
    expect(findPressure(w.truth, "debt", scopeOf(r?.scope as EntityRef))).toBeUndefined();
  });

  it("rechaza valores fuera de 0..1", () => {
    const ctx = { truth: new WorldTruth(), now: 0, newId: () => makeId("pressure", 1) } as never;
    expect(() =>
      citePressure(ctx, { kind: "hunger", scope: scopeOf(VILLAGE), value: 1.2 }, draftEvent(0)),
    ).toThrow(RangeError);
  });
});

describe("invariantes de las presiones citadas", () => {
  it("una cita sin registro, sin valor o a una presión inexistente es una violación", () => {
    const w = world(2);
    w.scheduler.advanceTo(20 * DAY);
    const log = new EventLog();
    for (const e of w.log.all()) log.append(e);
    const last = w.log.all().at(-1);
    expect(last).toBeDefined();
    const bad = {
      ...(last as NonNullable<typeof last>),
      id: makeId("event", (w.log.all().length + 100) as number),
      causes: [{ kind: "pressure" as const, pressure: makeId("pressure", 999) }],
    };
    log.append(bad);
    const problems = checkInvariants({ truth: w.truth, log });
    expect(problems.some((p) => p.includes("no existe"))).toBe(true);
    expect(problems.some((p) => p.includes("no tiene registro"))).toBe(true);
    expect(problems.some((p) => p.includes("valor del momento"))).toBe(true);
  });

  it("un registro que cuenta mal sus descargas se detecta", () => {
    const w = world(7);
    w.scheduler.advanceTo(60 * DAY);
    const [id] = w.truth.ids(PRESSURE);
    const r = w.truth.get(PRESSURE, id as EntityRef);
    expect(r).toBeDefined();
    w.truth.set(PRESSURE, id as EntityRef, { ...(r as NonNullable<typeof r>), discharges: 99 });
    expect(checkInvariants(w).some((p) => p.includes("descargas"))).toBe(true);
  });
});

describe("chispas", () => {
  const spark: Spark = {
    kind: "hunger",
    event: makeId("event", 1),
    strength: 0.4,
    at: 100,
    expiresAt: 200,
  };

  it("bajan el umbral al nacer, decaen y vencen", () => {
    expect(sparkStrength(spark, 100)).toBeCloseTo(0.4);
    expect(sparkStrength(spark, 150)).toBeCloseTo(0.2);
    expect(sparkStrength(spark, 200)).toBe(0);
    expect(sparkStrength(spark, 50)).toBe(0);
  });

  it("se guardan en el alcance, se combinan sin pasar de 1 y se limpian al agregar", () => {
    const truth = new WorldTruth();
    const hh = makeId("household", 1);
    const apply = (c: ReturnType<typeof addSpark>) =>
      truth.setRaw(c.table, c.id, (c as { value: unknown }).value);
    apply(addSpark(truth, hh, spark, 100));
    apply(addSpark(truth, hh, { ...spark, strength: 0.5, at: 100, expiresAt: 300 }, 100));
    const both = sparkOf(truth, "hunger", hh, 100);
    expect(both).toBeCloseTo(1 - 0.6 * 0.5);
    expect(both).toBeLessThanOrEqual(1);
    expect(sparkOf(truth, "debt", hh, 100)).toBe(0);
    // la primera venció: agregar otra la descarta
    apply(addSpark(truth, hh, { ...spark, at: 250, expiresAt: 350 }, 250));
    expect(truth.get(SPARKS, hh)?.sparks).toHaveLength(2);
  });

  it("rechaza chispas sin fuerza o sin duración", () => {
    const truth = new WorldTruth();
    const hh = makeId("household", 1);
    expect(() => addSpark(truth, hh, { ...spark, strength: 0 }, 0)).toThrow(RangeError);
    expect(() => addSpark(truth, hh, { ...spark, expiresAt: 100 }, 0)).toThrow(RangeError);
  });
});
