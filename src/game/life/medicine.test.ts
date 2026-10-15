import { describe, expect, it } from "vitest";
import type { AgentId, EntityRef, EventId, HolderRef } from "../../core/index.ts";
import { holderAccount, Rng } from "../../core/index.ts";
import {
  BODY_STATE,
  draftEvent,
  ENTITY,
  FROSTBITE,
  FROSTBITE_ORDERS,
  INFECTION,
  LOT_QUALITY,
  PATHOGEN,
  PATIENT_BELIEF,
  type PathogenDef,
  PERSON,
  PERSON_SUBSTANCE,
  type ProcessContext,
  REFERENCE_QUALITY,
  type RemedyDef,
  SKILL_STATE,
  type SubstanceDef,
  type SubstanceState,
  TREATMENT,
  WorldTruth,
} from "../../sim/index.ts";
import { exposureProcess } from "./exposure.ts";
import {
  chooseRemedyDose,
  frostbiteCare,
  type Healer,
  healerFee,
  healerRenown,
  lotPotency,
  medicineProcess,
  type RemedyDose,
  type RemedyDosing,
  signsOfBody,
  signsOfFrostbite,
  signsOfSubstances,
} from "./medicine.ts";
import { substancesProcess } from "./substances.ts";

const clock = { day: 86400, year: 86400 * 360, moons: [] };
const flu: PathogenDef = {
  id: "flu",
  routes: { air: 1, contact: 1 },
  incubationHours: 24,
  courseHours: 48,
  contagiousFrom: 0.5,
  transmissibility: 50,
  lethality: 0,
  immunity: "lifelong",
  immunityHours: 0,
};
const tea: RemedyDef = {
  id: "tea",
  targets: ["flu"],
  onsetHours: 1,
  peakHours: 6,
  endHours: 48,
  potency: 0.9,
  optimalDose: 1,
  toxicDose: 3,
  placebo: 0.2,
};
const sick = "agent:1" as AgentId;
const kin = "agent:2" as AgentId;
const doc = "agent:3" as AgentId;
const place = { kind: "cell", cell: "cell:1" } as never;
const healer: Healer = {
  agent: doc,
  skill: 1,
  models: [{ id: "flu", signature: { fever: 1, weakness: 1 }, prior: 0 }],
  remedies: [tea],
  remedyFor: { flu: "tea" },
  isolation: 1,
  compliance: 1,
};

function world(): WorldTruth {
  const t = new WorldTruth();
  for (const id of [sick, kin, doc]) {
    t.set(
      ENTITY,
      id as EntityRef,
      { id, originEventId: "event:1" as EventId, createdAt: 0 } as never,
    );
    t.set(PERSON, id as EntityRef, { household: id === doc ? "h:2" : "h:1" } as never);
    t.set(BODY_STATE, id as EntityRef, { muscle: 0.5 } as never);
  }
  t.set(PATHOGEN, "pathogen:1" as EntityRef, { def: flu, source: "test" });
  t.set(INFECTION, sick as EntityRef, {
    infections: [
      { pathogen: "flu", exposedAt: 0, dose: 1, fatal: false, cause: "event:9" as EventId },
    ],
    immunities: [],
    ill: ["flu"],
  });
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

describe("life.medicine", () => {
  it("sin sanadores no hace nada", () => {
    const p = medicineProcess({ clock, placeOf: () => place });
    expect(p.run(ctx(world(), clock.day * 2))).toEqual({});
  });

  it("el sanador diagnostica y trata al enfermo con causas, determinista", () => {
    const p = medicineProcess({ clock, healers: [healer], placeOf: () => place });
    const out = p.run(ctx(world(), clock.day * 2));
    expect(out.events?.map((e) => e.kind)).toEqual(["body.diagnosed", "body.treated"]);
    expect(out.events?.[1]?.causes[0]).toMatchObject({ kind: "event" });
    const ch = out.changes?.find((c) => c.table === TREATMENT.name);
    expect(ch).toBeDefined();
    expect(p.run(ctx(world(), clock.day * 2))).toEqual(out);
  });

  it("la cuarentena baja la dosis que llega al hogar", () => {
    const base = world();
    const quarantined = world();
    quarantined.set(TREATMENT, sick as EntityRef, {
      treatments: [
        {
          pathogen: "flu",
          healer: doc,
          believed: "flu",
          confidence: 1,
          remedy: null,
          effect: 0,
          harm: 0,
          quarantine: { isolation: 1, compliance: 1, caregiverHygiene: 1, separateWater: true },
          givenAt: 0,
          cause: "event:8",
        },
      ],
    });
    const e = exposureProcess({ clock, placeOf: () => place });
    const infects = (t: WorldTruth) =>
      e
        .run(ctx(t, clock.day * 2))
        .events?.some((ev) => ev.kind === "body.infected" && ev.actors[0] === kin) ?? false;
    expect(infects(base)).toBe(true);
    expect(infects(quarantined)).toBe(false);
  });

  it("con stock el remedio sale del lote del sanador, va al sumidero y sin existencias no se da", () => {
    const acc = holderAccount(doc as unknown as HolderRef);
    const withLedger = (n: number) => {
      const c = ctx(world(), clock.day * 2) as { ledger?: unknown };
      c.ledger = { balance: (a: string, u: string) => (a === acc && u === "herb" ? n : 0) };
      return c as unknown as ProcessContext;
    };
    const p = medicineProcess({
      clock,
      healers: [healer],
      stock: { tea: "herb" },
      placeOf: () => place,
    });
    const out = p.run(withLedger(1));
    expect(out.postings).toHaveLength(1);
    expect(out.postings?.[0]?.transfers[0]).toMatchObject({ unit: "herb", from: acc, amount: 1 });
    expect(out.postings?.[0]?.event).toBe(draftEvent(1));
    const empty = p.run(withLedger(0));
    expect(empty.postings).toBeUndefined();
    expect(empty.events?.[1]?.data).toMatchObject({ remedy: null });
  });

  it("sanador desde las habilidades: quien tiene medicine atiende, sin lista explícita", () => {
    const { agent: _a, skill: _s, ...school } = healer;
    const t = world();
    const lvl = (v: number) => ({ level: v, peak: v });
    t.set(SKILL_STATE, doc as EntityRef, {
      medicine: {
        facets: { execution: lvl(0.6), knowledge: lvl(0.6), judgment: lvl(0.6) },
        hours: 100,
        lastPracticed: null,
      },
    });
    const p = medicineProcess({ clock, school, placeOf: () => place });
    const out = p.run(ctx(t, clock.day * 2));
    expect(out.events?.[0]?.actors[0]).toBe(doc);
    const none = medicineProcess({
      clock,
      school: { ...school, minSkill: 0.9 },
      placeOf: () => place,
    });
    expect(none.run(ctx(t, clock.day * 2))).toEqual({});
    expect(p.run(ctx(t, clock.day * 2))).toEqual(out);
  });

  it("signos desde el cuerpo, fama y precio del sanador", () => {
    const plan = { id: "p", zones: [], physiology: { refMassKg: 70 } } as never;
    const body = {
      massKg: 70,
      blood: 1,
      fatigue: 0.9,
      wounds: [],
      water: 0,
      glycogen: 1e9,
      fat: 1e9,
      muscle: 1,
      sleepDebt: 0,
      sepsis: 0,
      consciousness: "awake",
    } as never;
    const s = signsOfBody(plan, body) as { fever?: number; weakness?: number };
    expect(s.fever).toBe(0.8);
    expect(s.weakness).toBe(0.8);
    expect(healerRenown(10, 9)).toBeGreaterThan(healerRenown(10, 2));
    expect(healerFee(10, 0.5, 1)).toBeGreaterThan(healerFee(10, 0.5, 0));
  });
});

describe("life.medicine, señales de sustancias", () => {
  const def = {
    id: "toxin",
    routes: { ingest: { bioavailability: 1, halfHours: 1 } },
    halfLifeHours: 10,
    ec50: 2,
    hill: 1,
    latencyHours: 0,
    toxicThreshold: 1,
    damagePerHourAtDouble: 0.1,
    repairHalfHours: 24,
  } as unknown as SubstanceDef;
  const state = (damage: number) =>
    ({
      depot: {},
      blood: 0,
      site: 0,
      damage,
      tolerance: 0,
      dependence: 0,
      hoursSinceUse: 0,
    }) as unknown as SubstanceState;

  it("sin sustancias no hay señales; el envenenamiento sube con la etapa", () => {
    expect(signsOfSubstances([])).toEqual({});
    const mild = signsOfSubstances([{ def, state: state(0.1) }]) as { weakness?: number };
    const grave = signsOfSubstances([{ def, state: state(0.5) }]) as {
      weakness?: number;
      pallor?: number;
    };
    expect(mild.weakness).toBe(0.4);
    expect(grave.weakness).toBe(0.7);
    expect(grave.pallor).toBe(0.5);
  });
});

describe("life.medicine, señales de congelación", () => {
  type Frost = { blisters?: number; blackTissue?: number; missingPart?: number };
  it("sin lesión no hay señales ni cuidados; crecen con la etapa", () => {
    const none = { hands: 0, feet: 0, face: 0, at: 0 };
    expect(signsOfFrostbite(none)).toEqual({});
    expect(frostbiteCare(none)).toEqual([]);
    expect((signsOfFrostbite({ ...none, hands: 0.6 }) as Frost).blisters).toBe(0.7);
    expect(frostbiteCare({ ...none, hands: 0.6 })).toEqual(["rewarm", "insulate"]);
    const dead = { ...none, feet: 0.9 };
    expect((signsOfFrostbite(dead) as Frost).blackTissue).toBe(0.9);
    expect(frostbiteCare(dead)).toEqual(["rewarm", "insulate", "amputate"]);
    const lost = { lost: [{ part: "feet" as const, at: 1, cause: "e" as never }] };
    expect((signsOfFrostbite(dead, lost) as Frost).missingPart).toBe(1);
  });
});

describe("life.medicine, pedido de cuidado de congelación", () => {
  const run = (on: boolean, skill = 1) => {
    const t = world();
    t.set(FROSTBITE, sick as EntityRef, { hands: 0.6, feet: 0.9, face: 0, at: 0 });
    return medicineProcess({
      clock,
      healers: [{ ...healer, skill }],
      frostbiteOrders: on,
      placeOf: () => place,
    }).run(ctx(t, clock.day * 2));
  };
  const row = (o: ReturnType<typeof run>) =>
    (o.changes?.find((c) => c.table === FROSTBITE_ORDERS.name) as never as { value: never })
      ?.value as { rewarm: number; amputate: string[]; by: string } | undefined;

  it("apagado no escribe; encendido pide recalentar, aislar y amputar lo necrosado, con causa", () => {
    expect(row(run(false))).toBeUndefined();
    const on = run(true);
    expect(row(on)).toMatchObject({ amputate: ["feet"], by: doc });
    expect(on.events?.some((e) => e.kind === "body.frostbite_ordered")).toBe(true);
    expect(on.events?.[0]?.causes[0]).toMatchObject({ kind: "state", key: "body.frostbite" });
    expect(run(true)).toEqual(on);
  });

  it("con poca habilidad no opera", () => {
    expect(row(run(true, 0.1))?.amputate).toEqual([]);
  });
});

describe("life.medicine, remedio con dosis real", () => {
  const herb = {
    id: "herb",
    routes: { ingest: { bioavailability: 1, halfHours: 1 } },
    halfLifeHours: 10,
    ec50: 0.5,
    hill: 1,
    latencyHours: 0,
    toxicThreshold: 0,
    damagePerHourAtDouble: 0,
    repairHalfHours: 24,
  } as unknown as SubstanceDef;
  const real: RemedyDose = { def: herb, route: "ingest", amount: 1 };
  const treat = (doses?: Record<string, RemedyDose>) =>
    medicineProcess({ clock, healers: [healer], doses, placeOf: () => place }).run(
      ctx(world(), clock.day * 2),
    );

  it("opt-in: apagado igual que siempre, encendido deja la dosis y el efecto sale de la sustancia", () => {
    const off = treat();
    const on = treat({ tea: real });
    const row = (o: typeof off) =>
      (o.changes?.find((c) => c.table === TREATMENT.name) as never as { value: never })?.value as {
        treatments: { effect: number; dose?: unknown }[];
      };
    expect(row(off).treatments[0]?.dose).toBeUndefined();
    expect(row(on).treatments[0]?.dose).toMatchObject({ route: "ingest", amount: 1 });
    expect(row(on).treatments[0]?.effect).not.toBe(row(off).treatments[0]?.effect);
    expect(treat({ tea: real })).toEqual(on);
  });

  it("life.substances aplica la dosis del tratamiento con el tratamiento como causa", () => {
    const t = world();
    t.set(TREATMENT, sick as EntityRef, {
      treatments: [
        {
          pathogen: "flu",
          healer: doc,
          believed: "flu",
          confidence: 1,
          remedy: "tea",
          effect: 0.5,
          harm: 0,
          quarantine: null,
          dose: { def: herb, route: "ingest", amount: 1 },
          givenAt: clock.day,
          cause: "event:77",
        },
      ],
    });
    const now = clock.day * 2;
    const run = (on: boolean) =>
      substancesProcess({ clock, treatmentDoses: on, placeOf: () => place }).run(ctx(t, now));
    expect(run(false)).toEqual({});
    const out = run(true);
    expect(out.events?.[0]?.causes[0]).toEqual({ kind: "event", event: "event:77" });
    expect(out.changes?.some((c) => c.table === PERSON_SUBSTANCE.name)).toBe(true);
  });
});

describe("life.medicine, dosis desde el lote y según el enfermo", () => {
  const herb = {
    id: "herb",
    routes: { ingest: { bioavailability: 1, halfHours: 1 } },
    halfLifeHours: 10,
    ec50: 0.5,
    hill: 1,
    latencyHours: 0,
    toxicThreshold: 0,
    damagePerHourAtDouble: 0,
    repairHalfHours: 24,
  } as unknown as SubstanceDef;
  const real: RemedyDose = { def: herb, route: "ingest", amount: 1 };
  const acc = holderAccount(doc as unknown as HolderRef);
  type Row = {
    treatments: {
      dose?: { amount: number };
      lot?: { unit: string; holder: string; takes: number; quality: number };
    }[];
  };
  const run = (o: {
    dosing?: RemedyDosing;
    have: number;
    quality?: number;
    massKg?: number;
    skill?: number;
  }) => {
    const t = world();
    if (o.quality !== undefined) t.set(LOT_QUALITY, doc as EntityRef, { herb: o.quality });
    if (o.massKg !== undefined) {
      t.set(BODY_STATE, sick as EntityRef, { muscle: 0.5, massKg: o.massKg } as never);
    }
    const c = ctx(t, clock.day * 2) as { ledger?: unknown };
    c.ledger = { balance: (a: string, u: string) => (a === acc && u === "herb" ? o.have : 0) };
    const out = medicineProcess({
      clock,
      healers: [{ ...healer, skill: o.skill ?? 1 }],
      stock: { tea: "herb" },
      doses: { tea: real },
      dosing: o.dosing,
      placeOf: () => place,
    }).run(c as unknown as ProcessContext);
    const row = (out.changes?.find((ch) => ch.table === TREATMENT.name) as never as { value: Row })
      ?.value.treatments[0];
    return { out, row, spent: out.postings?.[0]?.transfers[0]?.amount };
  };

  it("pura: más masa o lote más flojo piden más tomas; con habilidad plena el error no cuenta", () => {
    const base = { massKg: 60, refMassKg: 60, believedPotency: 1, skill: 1, noise: 1, maxTakes: 3 };
    expect(chooseRemedyDose(base)).toEqual({ multiplier: 1, takes: 1 });
    expect(chooseRemedyDose({ ...base, massKg: 90 })).toEqual({ multiplier: 1.5, takes: 2 });
    expect(chooseRemedyDose({ ...base, believedPotency: 0.5 }).multiplier).toBe(2);
    expect(chooseRemedyDose({ ...base, massKg: 10 }).multiplier).toBe(0.25);
    expect(chooseRemedyDose({ ...base, massKg: 600 })).toEqual({ multiplier: 3, takes: 3 });
    expect(chooseRemedyDose({ ...base, skill: 0 }).multiplier).toBeCloseTo(1.3);
    expect(lotPotency(REFERENCE_QUALITY)).toBe(1);
  });

  it("apagado: una toma, la dosis de siempre y sin lote", () => {
    const { row, spent } = run({ have: 5, quality: 0.35, massKg: 120 });
    expect(spent).toBe(1);
    expect(row?.dose?.amount).toBe(1);
    expect(row?.lot).toBeUndefined();
  });

  it("byLot: la sustancia escala con la calidad real del lote y el tratamiento guarda de dónde salió", () => {
    const on = run({ dosing: { byLot: true }, have: 5, quality: 0.35 });
    expect(on.spent).toBe(1);
    expect(on.row?.dose?.amount).toBe(0.5);
    expect(on.row?.lot).toEqual({ unit: "herb", holder: doc, takes: 1, quality: 0.35 });
    expect(on.out.events?.[1]?.data).toMatchObject({ amount: 0.5, lot: { holder: doc } });
    expect(run({ dosing: { byLot: true }, have: 5, quality: 0.35 }).out).toEqual(on.out);
  });

  it("byPatient: el enfermo pesado pide más tomas, se gastan enteras y no más de las que hay", () => {
    const heavy = run({ dosing: { byPatient: true }, have: 5, massKg: 120 });
    expect(heavy.spent).toBe(2);
    expect(heavy.row?.dose?.amount).toBe(2);
    const short = run({ dosing: { byPatient: true }, have: 1, massKg: 120 });
    expect(short.spent).toBe(1);
    expect(short.row?.dose?.amount).toBe(1);
    // Lote flojo y sanador que lo ve: compensa con más tomas; la sustancia que llega es la toma por la potencia real.
    const weak = run({ dosing: { byPatient: true, byLot: true }, have: 5, quality: 0.35 });
    expect(weak.spent).toBe(2);
    expect(weak.row?.dose?.amount).toBe(1);
    // Conservación: lo que sale del lote es lo que entra al sumidero, en tomas enteras.
    const tr = weak.out.postings?.[0]?.transfers[0];
    expect(tr).toMatchObject({ from: acc, to: "ext:remedy_used", amount: 2 });
    // Determinista también con el error del sanador poco hábil.
    const clumsy = () => run({ dosing: { byPatient: true }, have: 5, massKg: 70, skill: 0.2 });
    expect(clumsy().out).toEqual(clumsy().out);
  });
});

describe("life.medicine, fama por rumor y cobro", () => {
  const doc2 = "agent:4" as AgentId;
  const unit = "unit:coin" as never;
  const twoHealers = () => {
    const t = world();
    t.set(
      ENTITY,
      doc2 as EntityRef,
      {
        id: doc2,
        originEventId: "event:1" as EventId,
        createdAt: 0,
      } as never,
    );
    return t;
  };
  const balances = (m: Record<string, number>) =>
    ({ balance: (acc: string) => m[acc] ?? 0, holdings: () => [] }) as never;
  const run = (renown: Record<string, number>, purse: number) => {
    const t = twoHealers();
    const c = {
      ...ctx(t, clock.day * 2),
      ledger: balances({ [holderAccount(sick as unknown as HolderRef)]: purse }),
    };
    return medicineProcess({
      clock,
      healers: [healer, { ...healer, agent: doc2 }],
      fee: { unit, base: 10, renownOf: (_t, _p, h) => renown[h] },
      placeOf: () => place,
    }).run(c as never);
  };

  it("el enfermo elige al de mejor fama creída y le paga con asiento", () => {
    const out = run({ [doc]: 0.2, [doc2]: 0.9 }, 100);
    const treated = out.events?.find((e) => e.kind === "body.treated");
    expect(treated?.actors[0]).toBe(doc2);
    const tr = out.postings?.[0]?.transfers[0];
    expect(tr?.to).toBe(holderAccount(doc2 as unknown as HolderRef));
    expect(tr?.amount).toBe(Math.round(healerFee(10, 1, 0.9)));
    expect(run({ [doc]: 0.2, [doc2]: 0.9 }, 100)).toEqual(out);
  });

  it("sin bolsa lo atienden igual y no hay cobro; sin la opción no hay cobro", () => {
    const out = run({ [doc2]: 0.9 }, 0);
    expect(out.postings).toBeUndefined();
    expect(out.events?.some((e) => e.kind === "body.treated")).toBe(true);
    const off = medicineProcess({ clock, healers: [healer], placeOf: () => place }).run(
      ctx(world(), clock.day * 2),
    );
    expect(off.postings).toBeUndefined();
  });
});

describe("life.medicine, cuarentena por decisión del paciente", () => {
  const run = (trust: number | undefined, contagion?: number) =>
    medicineProcess({
      clock,
      healers: [healer],
      patientDecides: {
        trustOf: () => trust,
        ...(contagion === undefined ? {} : { contagionBelief: { flu: contagion } }),
      },
      placeOf: () => place,
    }).run(ctx(world(), clock.day * 2));
  const treatment = (out: ReturnType<ReturnType<typeof medicineProcess>["run"]>) => {
    const ch = out.changes?.find((c) => c.table === TREATMENT.name) as unknown as
      | { value: { treatments: { quarantine: unknown }[] } }
      | undefined;
    return ch?.value.treatments[0];
  };

  it("apagado el aislamiento del sanador se aplica, sin tabla ni evento nuevos", () => {
    const off = medicineProcess({ clock, healers: [healer], placeOf: () => place }).run(
      ctx(world(), clock.day * 2),
    );
    expect(off.events?.map((e) => e.kind)).toEqual(["body.diagnosed", "body.treated"]);
    expect(off.changes?.some((c) => c.table === PATIENT_BELIEF.name)).toBe(false);
    expect(treatment(off)?.quarantine).not.toBeNull();
  });

  it("el paciente que confía y cree que se pega se aísla, con causa y creencia guardada", () => {
    const out = run(0.9, 0.9);
    expect(out.events?.map((e) => e.kind)).toEqual([
      "body.diagnosed",
      "body.treated",
      "body.quarantine_decided",
    ]);
    expect(out.events?.[2]?.data).toMatchObject({ quarantined: true, doubts: false });
    expect(out.events?.[2]?.causes[0]).toMatchObject({ kind: "event" });
    expect(treatment(out)?.quarantine).not.toBeNull();
    expect(out.changes?.some((c) => c.table === PATIENT_BELIEF.name)).toBe(true);
    expect(run(0.9, 0.9)).toEqual(out);
  });

  it("si no cree que se pega, o desconfía del sanador, no se aísla", () => {
    expect(treatment(run(0.9, 0))?.quarantine).toBeNull();
    const doubtful = run(0.1, 0.9);
    expect(doubtful.events?.[2]?.data).toMatchObject({ doubts: true, quarantined: false });
    expect(treatment(doubtful)?.quarantine).toBeNull();
  });
});

describe("life.medicine, segunda opinion y autoridad", () => {
  const doc2 = "agent:4" as AgentId;
  const second: Healer = { ...healer, agent: doc2 };
  const mk = (extra: object) =>
    medicineProcess({
      clock,
      healers: [healer, second],
      patientDecides: { trustOf: (_t, _p, h) => (h === doc ? 0.1 : 0.9), ...extra },
      placeOf: () => place,
    });
  const w = () => {
    const t = world();
    t.set(
      ENTITY,
      doc2 as EntityRef,
      { id: doc2, originEventId: "event:1" as EventId, createdAt: 0 } as never,
    );
    return t;
  };

  const apply = (t: WorldTruth, changes: readonly unknown[] | undefined) => {
    for (const c of (changes ?? []) as { table: string; value: never }[]) {
      if (c.table === TREATMENT.name) t.set(TREATMENT, sick as EntityRef, c.value);
      else if (c.table === PATIENT_BELIEF.name) t.set(PATIENT_BELIEF, sick as EntityRef, c.value);
    }
  };

  it("el que discrepa llama a otro sanador, una sola vez, y reemplaza el tratamiento", () => {
    const t = w();
    const p = mk({ secondOpinion: true });
    const first = p.run(ctx(t, clock.day * 2));
    expect(first.events?.[2]?.data).toMatchObject({ doubts: true });
    apply(t, first.changes);
    const out = p.run(ctx(t, clock.day * 2 + 3600));
    const ev = out.events?.find((e) => e.kind === "body.quarantine_decided");
    expect(ev?.actors).toEqual([sick, doc2]);
    expect(ev?.data).toMatchObject({ doubts: false, quarantined: true });
    const tr = out.changes?.find((c) => c.table === TREATMENT.name) as unknown as {
      value: { treatments: unknown[] };
    };
    expect(tr.value.treatments).toHaveLength(1);
    apply(t, out.changes);
    expect(p.run(ctx(t, clock.day * 2 + 7200))).toEqual({});
  });

  it("apagado no hay segunda opinion", () => {
    const t = w();
    const p = mk({});
    const first = p.run(ctx(t, clock.day * 2));
    apply(t, first.changes);
    expect(p.run(ctx(t, clock.day * 2 + 3600))).toEqual({});
  });

  it("la autoridad impone el aislamiento aunque dude del sanador", () => {
    const out = mk({ authorityOf: () => 0.8 }).run(ctx(w(), clock.day * 2));
    expect(out.events?.find((e) => e.kind === "body.quarantine_decided")?.data).toMatchObject({
      doubts: true,
      quarantined: true,
    });
  });
});
