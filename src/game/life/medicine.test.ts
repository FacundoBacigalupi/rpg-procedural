import { describe, expect, it } from "vitest";
import type { AgentId, EntityRef, EventId, HolderRef } from "../../core/index.ts";
import { holderAccount, Rng } from "../../core/index.ts";
import {
  BODY_STATE,
  draftEvent,
  ENTITY,
  INFECTION,
  PATHOGEN,
  type PathogenDef,
  PERSON,
  type ProcessContext,
  type RemedyDef,
  SKILL_STATE,
  type SubstanceDef,
  type SubstanceState,
  TREATMENT,
  WorldTruth,
} from "../../sim/index.ts";
import { exposureProcess } from "./exposure.ts";
import {
  frostbiteCare,
  type Healer,
  healerFee,
  healerRenown,
  medicineProcess,
  signsOfBody,
  signsOfFrostbite,
  signsOfSubstances,
} from "./medicine.ts";

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
