import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { AgentId, EventId, OrgId, SettlementId } from "../../core/index.ts";
import {
  activeMembers,
  chooseElders,
  DEFAULT_COUNCIL_RULES,
  type ElderCandidate,
  eldership,
  foundCouncil,
  holderOf,
  isMember,
  orgViolations,
  withdrawMember,
} from "./index.ts";

const ag = (n: number) => `agent:${n}` as AgentId;
const ev = (n: number) => `event:${n}` as EventId;
const org = "org:1" as OrgId;
const settlement = "settlement:1" as SettlementId;

const cand = (n: number, ageYears: number, respect?: number): ElderCandidate => ({
  agent: ag(n),
  ageYears,
  ...(respect !== undefined ? { respect } : {}),
});

describe("sim/org: consejo de aldea", () => {
  it("elige a los de más edad y respeto; los jóvenes no se sientan", () => {
    const got = chooseElders([cand(1, 30), cand(2, 70), cand(3, 60), cand(4, 50, 1), cand(5, 46)]);
    expect(got.map((c) => c.agent)).toEqual([ag(4), ag(2), ag(3), ag(5)]);
  });

  it("con menos ancianos que el mínimo no se funda", () => {
    expect(chooseElders([cand(1, 60), cand(2, 20)])).toEqual([]);
  });

  it("el respeto puede pasar a la edad; el desempate es por id", () => {
    expect(eldership(cand(1, 50, 1))).toBeGreaterThan(eldership(cand(2, 60, 0)));
    const got = chooseElders([cand(9, 60), cand(3, 60), cand(5, 60)]);
    expect(got.map((c) => c.agent)).toEqual([ag(3), ag(5), ag(9)]);
  });

  it("funda con origen, fundadores, cabeza y puesto", () => {
    const elders = chooseElders([cand(1, 70), cand(2, 60), cand(3, 55)]);
    const o = foundCouncil({ id: org, settlement, elders, originEventId: ev(7), at: 100 });
    expect(o.originEventId).toBe(ev(7));
    expect(o.founders).toEqual([ag(1), ag(2), ag(3)]);
    expect(holderOf(o, "head")).toBe(ag(1));
    expect(activeMembers(o)).toHaveLength(3);
    expect(o.members.every((m) => m.originEventId === ev(7))).toBe(true);
    expect(orgViolations(o)).toEqual([]);
  });

  it("la muerte del cabeza cierra su membresía y deja el puesto vacante; sin nadie se disuelve", () => {
    const o = foundCouncil({
      id: org,
      settlement,
      elders: chooseElders([cand(1, 70), cand(2, 60)]),
      originEventId: ev(7),
      at: 100,
    });
    const a = withdrawMember(o, ag(1), { at: 200, kind: "death", event: ev(9) });
    expect(isMember(a, ag(1))).toBe(false);
    expect(holderOf(a, "head")).toBeNull();
    expect(a.status).toBe("active");
    expect(orgViolations(a)).toEqual([]);
    expect(withdrawMember(a, ag(1), { at: 300, kind: "death", event: ev(10) })).toBe(a);
    const b = withdrawMember(a, ag(2), { at: 300, kind: "death", event: ev(10) });
    expect(b.status).toBe("dissolved");
    expect(orgViolations(b)).toEqual([]);
  });

  it("propiedades: nunca más asientos que los pedidos, todos con edad mínima, sin repetidos, determinista", () => {
    const candidates = fc.uniqueArray(
      fc.record({
        n: fc.integer({ min: 1, max: 60 }),
        age: fc.double({ min: 0, max: 100, noNaN: true }),
        respect: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: undefined }),
      }),
      { selector: (c) => c.n, maxLength: 40 },
    );
    fc.assert(
      fc.property(candidates, fc.integer({ min: 1, max: 9 }), (cs, seats) => {
        const input = cs.map((c) => cand(c.n, c.age, c.respect));
        const rules = { ...DEFAULT_COUNCIL_RULES, seats };
        const got = chooseElders(input, rules);
        expect(got.length).toBeLessThanOrEqual(seats);
        expect(got.every((c) => c.ageYears >= rules.minAge)).toBe(true);
        expect(new Set(got.map((c) => c.agent)).size).toBe(got.length);
        expect(chooseElders([...input].reverse(), rules)).toEqual(got);
        if (got.length > 0) {
          const o = foundCouncil({ id: org, settlement, elders: got, originEventId: ev(1), at: 0 });
          expect(orgViolations(o)).toEqual([]);
        }
      }),
    );
  });
});
