import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { AgentId, EventId, HouseholdId, OrgId, SettlementId } from "../../core/index.ts";
import {
  ENTITY,
  foundCouncil,
  HOUSEHOLD,
  ORG,
  PERSON,
  RELATIONS,
  WorldTruth,
  withdrawMember,
} from "../../sim/index.ts";
import { councilSources, villageAuthority } from "./councilauthority.ts";
import { householdAuthority } from "./patientbonds.ts";

const ev = "event:1" as EventId;
const home = "household:1" as HouseholdId;
const sett = "settlement:1" as SettlementId;
const org1 = "org:1" as OrgId;
const kid = "agent:1" as AgentId;
const dad = "agent:2" as AgentId;
const chief = "agent:3" as AgentId;
const elder = "agent:4" as AgentId;
const dims = (respect: number) =>
  ({
    trust: 0,
    respect,
    affection: 0,
    fear: 0,
    attraction: 0,
    gratitude: 0,
    jealousy: 0,
    resentment: 0,
    familiarity: 0,
    dependency: 0,
  }) as never;
const rel = (respect: number) => ({ dims: dims(respect), bonds: [], history: [], updated: 0 });

function world(respects: { dad: number; chief: number; elder: number }, council = true) {
  const w = new WorldTruth();
  for (const [id, born] of [
    [kid, 100],
    [dad, 50],
    [chief, 60],
    [elder, 70],
  ] as const) {
    w.set(ENTITY, id, { id, originEventId: ev, createdAt: 0 } as never);
    w.set(PERSON, id, {
      sex: "male",
      born,
      mother: null,
      father: null,
      household: home,
      spouse: null,
    } as never);
  }
  w.set(HOUSEHOLD, home, { settlement: sett, members: [kid, dad, chief, elder] } as never);
  w.set(RELATIONS, kid, {
    originEventId: ev,
    toward: {
      [dad]: rel(respects.dad),
      [chief]: rel(respects.chief),
      [elder]: rel(respects.elder),
    },
  });
  if (council) {
    w.set(
      ORG,
      org1,
      foundCouncil({
        id: org1,
        settlement: sett,
        elders: [
          { agent: chief, ageYears: 80 },
          { agent: elder, ageYears: 60 },
        ],
        originEventId: ev,
        at: 0,
      }),
    );
  }
  return w;
}

describe("councilauthority", () => {
  it("el cabeza pesa mas que un anciano y todo se pondera por el respeto", () => {
    const o = { contagionBelief: { flu: 1 } };
    const w = world({ dad: 0, chief: 1, elder: 1 });
    const s = councilSources(w, kid, "flu", o);
    expect(s.map((x) => [x.holder, x.strength])).toEqual([
      [chief, 1],
      [elder, 0.6],
    ]);
    expect(villageAuthority(w, kid, "flu", o)).toBeCloseTo(1);
    const w2 = world({ dad: 0, chief: 0, elder: 0.5 });
    expect(villageAuthority(w2, kid, "flu", o)).toBeCloseTo(0.3);
  });

  it("sin consejo es identica al hogar; un consejero que sale deja de mandar", () => {
    const o = { contagionBelief: { flu: 0.8 } };
    const w = world({ dad: 0.5, chief: 1, elder: 1 }, false);
    expect(villageAuthority(w, kid, "flu", o)).toBeCloseTo(householdAuthority(w, kid, "flu", o));
    const w2 = world({ dad: 0, chief: 1, elder: 0 });
    const before = villageAuthority(w2, kid, "flu", o);
    const org = w2.get(ORG, org1);
    expect(org).toBeDefined();
    w2.set(
      ORG,
      org1,
      withdrawMember(org as never, chief, { at: 5, kind: "death", event: "event:2" as EventId }),
    );
    expect(villageAuthority(w2, kid, "flu", o)).toBeLessThan(before);
  });

  it("es determinista, acotada y el consejo solo suma al hogar", () => {
    const unit = fc.double({ min: 0, max: 1, noNaN: true });
    fc.assert(
      fc.property(unit, unit, unit, unit, (a, b, c, belief) => {
        const o = { contagionBelief: { flu: belief } };
        const w = world({ dad: a, chief: b, elder: c });
        const x = villageAuthority(w, kid, "flu", o);
        expect(x).toBe(villageAuthority(w, kid, "flu", o));
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(1);
        const more = villageAuthority(
          world({ dad: a, chief: b, elder: Math.min(1, c + 0.1) }),
          kid,
          "flu",
          o,
        );
        expect(more).toBeGreaterThanOrEqual(x - 1e-9);
        expect(x).toBeGreaterThanOrEqual(householdAuthority(w, kid, "flu", o) - 1e-9);
      }),
    );
  });
});
