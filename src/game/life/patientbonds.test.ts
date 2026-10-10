import { describe, expect, it } from "vitest";
import type { AgentId, EventId, HouseholdId } from "../../core/index.ts";
import {
  COMMUNITY_CULTURE,
  ENTITY,
  HOUSEHOLD,
  PERSON,
  RELATIONS,
  WorldTruth,
} from "../../sim/index.ts";
import { contagionBeliefOf, householdAuthority, householdHead, realTrust } from "./patientbonds.ts";

const ev = "event:1" as EventId;
const home = "household:1" as HouseholdId;
const kid = "agent:1" as AgentId;
const gran = "agent:2" as AgentId;
const dad = "agent:3" as AgentId;
const doc = "agent:4" as AgentId;
const person = (born: number) => ({
  sex: "female" as const,
  born,
  mother: null,
  father: null,
  household: home,
  spouse: null,
});
const dims = (o: object) =>
  ({
    trust: 0,
    respect: 0,
    affection: 0,
    fear: 0,
    attraction: 0,
    gratitude: 0,
    jealousy: 0,
    resentment: 0,
    familiarity: 0,
    dependency: 0,
    ...o,
  }) as never;
const rel = (d: object) => ({ dims: dims(d), bonds: [], history: [], updated: 0 });

function world(opts: { granDead?: boolean } = {}) {
  const w = new WorldTruth();
  for (const [id, born] of [
    [kid, 100],
    [gran, 0],
    [dad, 50],
  ] as const) {
    w.set(ENTITY, id, {
      id,
      originEventId: ev,
      createdAt: 0,
      ...(id === gran && opts.granDead ? { endedAt: 5 } : {}),
    } as never);
    w.set(PERSON, id, person(born));
  }
  w.set(HOUSEHOLD, home, { settlement: "settlement:1", members: [kid, gran, dad] } as never);
  w.set(RELATIONS, kid, {
    originEventId: ev,
    toward: {
      [gran]: rel({ respect: 0.8 }),
      [dad]: rel({ respect: 0.2 }),
      [doc]: rel({ trust: 0.5 }),
    },
  });
  return w;
}

describe("patientbonds", () => {
  it("el jefe es el vivo mas viejo", () => {
    expect(householdHead(world(), kid)).toBe(gran);
    expect(householdHead(world({ granDead: true }), kid)).toBe(dad);
  });

  it("la autoridad pesa respeto por lo que el jefe cree; el jefe no se manda a si mismo", () => {
    const o = { contagionBelief: { flu: 1 } };
    expect(householdAuthority(world(), kid, "flu", o)).toBeCloseTo(0.8);
    expect(householdAuthority(world({ granDead: true }), kid, "flu", o)).toBeCloseTo(0.2);
    expect(householdAuthority(world(), gran, "flu", o)).toBe(0);
    expect(householdAuthority(world(), kid, "flu", {})).toBeCloseTo(0.4);
  });

  it("la creencia de contagio y el jefe salen de la cultura si se pide; la tabla explicita manda", () => {
    const w = world();
    w.set(PERSON, dad, { ...person(50), sex: "male" as const });
    w.set(COMMUNITY_CULTURE, "settlement:1" as never, {
      culture: "c",
      name: "c",
      originEventId: ev,
      prevalence: {
        sickness: { variants: { miasma: 1 }, params: { flu: 0.9 }, origin: "inertia", because: "" },
        household_head: {
          variants: { eldest_male: 1 },
          params: {},
          origin: "inertia",
          because: "",
        },
      },
    });
    const o = { cultureTraits: { contagion: "sickness" } };
    expect(contagionBeliefOf(w, "flu", o)).toBeCloseTo(0.9);
    expect(contagionBeliefOf(w, "pox", o)).toBeCloseTo(0.5);
    expect(contagionBeliefOf(w, "flu", { ...o, contagionBelief: { flu: 0.1 } })).toBeCloseTo(0.1);
    expect(householdAuthority(w, kid, "flu", o)).toBeCloseTo(0.72);
    expect(householdHead(w, kid, { cultureTraits: { head: "household_head" } })).toBe(dad);
    expect(householdHead(w, kid)).toBe(gran);
  });

  it("la confianza sale de la relacion real; sin trato ni fama, queda el prior", () => {
    expect(realTrust(world(), kid, doc)).toBeCloseTo(0.7);
    expect(realTrust(world(), kid, dad)).toBeCloseTo(0.5);
    expect(realTrust(world(), dad, doc)).toBeUndefined();
  });
});
