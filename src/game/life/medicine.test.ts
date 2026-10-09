import { describe, expect, it } from "vitest";
import type { AgentId, EntityRef, EventId } from "../../core/index.ts";
import { Rng } from "../../core/index.ts";
import {
  BODY_STATE,
  ENTITY,
  INFECTION,
  PATHOGEN,
  type PathogenDef,
  PERSON,
  type ProcessContext,
  type RemedyDef,
  TREATMENT,
  WorldTruth,
} from "../../sim/index.ts";
import { exposureProcess } from "./exposure.ts";
import { type Healer, medicineProcess } from "./medicine.ts";

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
});
