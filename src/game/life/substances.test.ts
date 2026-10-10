import { describe, expect, it } from "vitest";
import type { AgentId, EntityRef, EventId } from "../../core/index.ts";
import { EventLog, IdAllocator, Rng } from "../../core/index.ts";
import {
  BODY_STATE,
  draftEvent,
  ENTITY,
  PERSON,
  PERSON_SUBSTANCE,
  type PersonSubstances,
  type ProcessContext,
  Scheduler,
  SUBSTANCE,
  type SubstanceDef,
  TREATMENT,
  WorldTruth,
} from "../../sim/index.ts";
import {
  consumeDose,
  cravingApproachMoves,
  cravingBorrowAsks,
  cravingBorrowMood,
  cravingBuyGoods,
  cravingBuyMood,
  cravingGatherMood,
  scaledDose,
  substancesProcess,
} from "./substances.ts";

const clock = { day: 86400, year: 86400 * 360, moons: [] };
const place = { kind: "cell", cell: "cell:1" } as never;
const a = "agent:1" as AgentId;
const POISON: SubstanceDef = {
  id: "slow-poison",
  routes: { ingest: { bioavailability: 0.9, halfHours: 2 } },
  halfLifeHours: 12,
  ec50: 5,
  hill: 1,
  latencyHours: 12,
  toxicThreshold: 4,
  damagePerHourAtDouble: 0.12,
  repairHalfHours: 48,
};

function world(): WorldTruth {
  const t = new WorldTruth();
  t.set(
    ENTITY,
    a as EntityRef,
    { id: a, originEventId: "event:1" as EventId, createdAt: 0 } as never,
  );
  t.set(PERSON, a as EntityRef, { household: "household:1" } as never);
  t.set(BODY_STATE, a as EntityRef, { muscle: 0.5 } as never);
  return t;
}

function ctx(truth: WorldTruth, now: number): ProcessContext {
  let n = 0;
  return {
    now,
    window: clock.day,
    truth,
    rng: Rng.root(1),
    newId: (k: string) => `${k}:~${n++}`,
  } as unknown as ProcessContext;
}

describe("life.substances", () => {
  it("scheduler resuelve causas de dosis de escenario y tratamiento a ids reales, preservando tiempo causal", () => {
    const truth = world();
    const ids = new IdAllocator();
    const log = new EventLog();
    const genesis = ids.next("event");
    log.append({
      id: genesis,
      tick: 0,
      kind: "genesis",
      actors: [a],
      place,
      data: null,
      emissions: {},
      causes: [{ kind: "seed" }],
      resolution: "local",
    });
    const treated = ids.next("event");
    log.append({
      id: treated,
      tick: 3600,
      kind: "body.treated",
      actors: [a],
      place,
      data: null,
      emissions: {},
      causes: [{ kind: "event", event: genesis }],
      resolution: "local",
    });
    truth.set(TREATMENT, a, {
      treatments: [
        {
          pathogen: "test",
          healer: "agent:2",
          believed: "test",
          confidence: 1,
          remedy: "herb",
          effect: 0.1,
          harm: 0,
          quarantine: null,
          dose: { def: POISON, route: "ingest", amount: 1 },
          givenAt: 3600,
          cause: treated,
        },
      ],
    });
    const p = substancesProcess({
      clock,
      placeOf: () => place,
      causalDoseOrigins: true,
      treatmentDoses: true,
      doses: [
        {
          def: POISON,
          who: a,
          at: 2000,
          route: "ingest",
          amount: 1,
          source: "escenario",
          cause: genesis,
        },
      ],
    });
    const scheduler = new Scheduler({
      rng: Rng.root(7),
      truth,
      clock,
      ids,
      log,
      processes: [p],
      resolution: "local",
    });
    scheduler.advanceTo(clock.day);
    const doses = log.all().filter((e) => e.kind === "body.substance_dosed");
    expect(doses.map((e) => e.tick)).toEqual([2000, 3600]);
    expect(doses[1]?.causes).toEqual([{ kind: "event", event: treated }]);
    expect(truth.get(PERSON_SUBSTANCE, a)?.held[0]?.originEventId).toBe(doses[1]?.id);
    scheduler.advanceTo(clock.day * 2);
    expect(truth.get(PERSON_SUBSTANCE, a)?.held[0]?.originEventId).toBe(doses[1]?.id);
    expect(JSON.stringify(truth.get(PERSON_SUBSTANCE, a))).not.toContain("event:~");
  });

  it("dosis propia conocida registra causa sólo opt-in y la conserva al metabolizar y podar", () => {
    const truth = world();
    truth.set(SUBSTANCE, "substance:1" as EntityRef, { def: POISON, source: "otro consumidor" });
    const doses = [
      {
        def: POISON,
        who: a,
        at: 100,
        route: "ingest" as const,
        amount: 1,
        source: "escenario",
        cause: "event:7",
      },
    ];
    const options = { clock, doses, placeOf: () => place };
    const off = substancesProcess(options).run(ctx(truth, clock.day));
    expect(
      substancesProcess({ ...options, causalDoseOrigins: false }).run(ctx(truth, clock.day)),
    ).toEqual(off);
    const on = substancesProcess({ ...options, causalDoseOrigins: true }).run(
      ctx(truth, clock.day),
    );
    expect(on.events?.[0]).toMatchObject({
      kind: "body.substance_dosed",
      actors: [a],
      tick: 100,
      causes: [{ kind: "event", event: "event:7" }],
    });
    const row = on.changes?.find((c) => c.op === "set" && c.table === PERSON_SUBSTANCE.name);
    const value = row && row.op === "set" ? (row.value as PersonSubstances) : undefined;
    expect(value?.held[0]?.originEventId).toBe(draftEvent(0));
    if (!value) throw new Error("dosis sin fila propia");
    truth.set(PERSON_SUBSTANCE, a, {
      ...value,
      held: value.held.map((h) => ({ ...h, originEventId: "event:9" as EventId })),
      cues: [
        {
          substance: POISON.id,
          kind: "place",
          key: "hex:0",
          at: clock.day,
          strength: 0.6,
          originEventId: "event:9" as EventId,
        },
      ],
    });
    const next = substancesProcess({ clock, placeOf: () => place }).run(ctx(truth, clock.day * 2));
    const nextRow = next.changes?.find((c) => c.op === "set" && c.table === PERSON_SUBSTANCE.name);
    const nextValue =
      nextRow && nextRow.op === "set" ? (nextRow.value as PersonSubstances) : undefined;
    expect(nextValue?.held[0]?.originEventId).toBe("event:9");
    expect(nextValue?.cues?.[0]?.originEventId).toBe("event:9");
  });

  it("sin dosis ni filas no hace nada", () => {
    const p = substancesProcess({ clock, placeOf: () => place });
    expect(p.run(ctx(world(), clock.day))).toEqual({});
  });

  it("una dosis letal crea la sustancia con origen y mata con causa poison", () => {
    const p = substancesProcess({
      clock,
      placeOf: () => place,
      doses: [{ def: POISON, who: a, at: 100, route: "ingest", amount: 200, source: "escenario" }],
    });
    const r = p.run(ctx(world(), clock.day));
    expect(r.events?.map((e) => e.kind)).toEqual(["body.substance_introduced", "body.died"]);
    expect(r.events?.[1]?.data).toMatchObject({ cause: "poison" });
    expect(r.changes?.some((c) => c.table === SUBSTANCE.name)).toBe(true);
  });
});

describe("consumeDose (verbo consume)", () => {
  const consumable = { good: "pipeweed", def: POISON, route: "ingest", amount: 3 } as const;
  it("sólo una acción de dosis real da procedencia propia a la fila y a señales reforzadas", () => {
    const truth = world();
    const learn = { ctx: { hex: 0, people: [], hour: 0 }, clock };
    const legacy = consumeDose(truth, a, consumable, ctx(truth, 500), place, 1, learn);
    expect(consumeDose(truth, a, consumable, ctx(truth, 500), place, 1, learn, undefined)).toEqual(
      legacy,
    );
    const intake = consumeDose(
      truth,
      a,
      consumable,
      ctx(truth, 500),
      place,
      1,
      learn,
      draftEvent(0),
    );
    const row = intake.changes.find((c) => c.op === "set" && c.table === PERSON_SUBSTANCE.name);
    const value = row && row.op === "set" ? (row.value as PersonSubstances) : undefined;
    expect(value?.held[0]?.originEventId).toBe(draftEvent(0));
    expect(value?.cues?.every((c) => c.originEventId === draftEvent(0))).toBe(true);
    if (!value) throw new Error("dosis sin fila propia");
    truth.set(PERSON_SUBSTANCE, a, {
      ...value,
      held: value.held.map((h) => ({ ...h, originEventId: "event:8" as EventId })),
      ...(value.cues
        ? { cues: value.cues.map((c) => ({ ...c, originEventId: "event:8" as EventId })) }
        : {}),
    });
    const reinforced = consumeDose(
      truth,
      a,
      consumable,
      ctx(truth, 600),
      place,
      1,
      learn,
      "event:9" as EventId,
    );
    const reinforcedRow = reinforced.changes.find(
      (c) => c.op === "set" && c.table === PERSON_SUBSTANCE.name,
    );
    const strengthened =
      reinforcedRow && reinforcedRow.op === "set"
        ? (reinforcedRow.value as PersonSubstances)
        : undefined;
    expect(strengthened?.held[0]?.originEventId).toBe("event:9");
    expect(strengthened?.cues?.every((c) => c.originEventId === ("event:9" as EventId))).toBe(true);
    const rejected = consumeDose(
      world(),
      a,
      { ...consumable, amount: 0 },
      ctx(world(), 500),
      place,
      1,
      learn,
      "event:9" as EventId,
    );
    const rejectedRow = rejected.changes.find(
      (c) => c.op === "set" && c.table === PERSON_SUBSTANCE.name,
    );
    expect(
      rejectedRow && rejectedRow.op === "set"
        ? (rejectedRow.value as PersonSubstances).held[0]?.originEventId
        : undefined,
    ).toBeUndefined();
  });

  it("suma la dosis con evento causal la primera vez y no repite el evento", () => {
    const t = world();
    const first = consumeDose(t, a, consumable, ctx(t, 500), place, 1);
    expect(first.events.map((e) => e.kind)).toEqual(["body.substance_introduced"]);
    expect(first.changes.some((c) => c.table === PERSON_SUBSTANCE.name)).toBe(true);
    expect(first.changes.some((c) => c.table === SUBSTANCE.name)).toBe(true);
    const sid = "substance:~0" as EntityRef;
    t.set(SUBSTANCE, sid, { def: POISON, source: "consume:pipeweed" } as never);
    const second = consumeDose(t, a, consumable, ctx(t, 600), place, 0);
    expect(second.events).toEqual([]);
    expect(second.changes.some((c) => c.table === SUBSTANCE.name)).toBe(false);
  });

  it("comer un lote con la sustancia: la dosis escala con los gramos (por gramo x gramos)", () => {
    const t = world();
    const tea = { ...consumable, good: "tea" };
    const small = consumeDose(t, a, { ...tea, amount: 0.5 * 10 }, ctx(t, 500), place, 0);
    const big = consumeDose(t, a, { ...tea, amount: 0.5 * 40 }, ctx(t, 500), place, 0);
    const held = (r: typeof small) =>
      JSON.stringify(r.changes.find((c) => c.table === PERSON_SUBSTANCE.name));
    expect(held(small)).not.toEqual(held(big));
    expect(small.events[0]?.data).toMatchObject({ source: "consume:tea" });
  });
});

describe("scaledDose (beber con sustancia)", () => {
  it("escala la dosis por litro y la deja fuera del lote original", () => {
    const tea = { good: "tea", def: POISON, route: "ingest", amount: 2 } as const;
    expect(scaledDose(tea, 0.75).amount).toBeCloseTo(1.5);
    expect(tea.amount).toBe(2);
  });
});

describe("comprar lo que se consume", () => {
  const o = { minCraving: 0.4, weight: 1, refPrice: 10 };
  it("solo con ansia alta y sin existencias, por nombre", () => {
    const names = [
      { name: "tea", have: 0 },
      { name: "ale", have: 3 },
      { name: "bark", have: 0 },
    ];
    expect(cravingBuyGoods(0.3, names, o)).toEqual([]);
    expect(cravingBuyGoods(0.5, names, o)).toEqual(["bark", "tea"]);
  });
  it("el empuje crece con el ansia y cae con el precio", () => {
    expect(cravingBuyMood(1, undefined, o)).toBe(1);
    expect(cravingBuyMood(1, 10, o)).toBe(0.5);
    expect(cravingBuyMood(0.5, 0, o)).toBe(0.5);
  });
  it("recolectar: el empuje crece con el ansia, sin precio", () => {
    const g = { minCraving: 0.4, weight: 0.8 };
    expect(cravingGatherMood(1, g)).toBe(0.8);
    expect(cravingGatherMood(0.5, g)).toBe(0.4);
    expect(cravingBuyGoods(0.3, [{ name: "bark", have: 0 }], g)).toEqual([]);
  });
});

describe("pedir prestada la sustancia", () => {
  const o = { minCraving: 0.4, weight: 1 };
  const has = (about: string, value: string, confidence: number) => ({
    rumor: { mold: "attr", about, attr: "has", value } as const,
    confidence,
  });
  const wants = [
    { name: "tea", have: 0 },
    { name: "ale", have: 2 },
  ];
  it("solo con ansia alta, sin existencias y a conocidos, por lo que cree", () => {
    const rumors = [
      has("b", "tea", 0.5),
      has("a", "tea", 0.4),
      has("a", "tea", 0.8),
      has("z", "tea", 1),
      has("a", "ale", 1),
    ];
    const known = new Set(["a", "b"]);
    expect(cravingBorrowAsks(0.3, wants, rumors, known, o)).toEqual([]);
    expect(cravingBorrowAsks(0.5, wants, rumors, known, o)).toEqual([
      { lender: "a", name: "tea", confidence: 0.8 },
      { lender: "b", name: "tea", confidence: 0.5 },
    ]);
  });
  it("el empuje crece con el ansia y con la confianza", () => {
    expect(cravingBorrowMood(1, 1, o)).toBe(1);
    expect(cravingBorrowMood(0.5, 0.5, o)).toBe(0.25);
  });
});

describe("ir hacia el prestamista", () => {
  const ask = { lender: "agent:2", name: "wine", confidence: 0.8 };
  const o = { minCraving: 0.3, weight: 1, approach: 0.5 };
  const place = (hex: number) => (hex === 7 ? "place:inn" : undefined);
  it("va al lugar donde lo cree, no a donde está", () => {
    const m = cravingApproachMoves([ask], () => 7, 1, place, 1, o);
    expect(m).toEqual([{ id: "move:place:inn+toward:agent:2", place: "place:inn", mood: 0.4 }]);
  });
  it("nada sin opt-in, sin creencia, en el mismo hex o sin lugar", () => {
    const { approach: _, ...off } = o;
    expect(cravingApproachMoves([ask], () => 7, 1, place, 1, off)).toEqual([]);
    expect(cravingApproachMoves([ask], () => undefined, 1, place, 1, o)).toEqual([]);
    expect(cravingApproachMoves([ask], () => 7, 7, place, 1, o)).toEqual([]);
    expect(cravingApproachMoves([ask], () => 9, 1, place, 1, o)).toEqual([]);
  });
});
