import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type AgentId, makeId, Rng } from "../../core/index.ts";
import {
  ageStrength,
  type Band,
  type BandCandidate,
  bandViolations,
  chooseBandSuccessor,
  chooseLeader,
  DEFAULT_BAND_RULES,
  deserts,
  desperation,
  dissolveBand,
  dissolveReason,
  foundBand,
  gatherFounders,
  joinBand,
  joinChance,
  leaderOf,
  leaveBand,
  memberAgents,
  raidChance,
  raidLoot,
  shareOut,
  succeedBand,
  treasuryOf,
} from "./band.ts";

const ag = (n: number) => makeId("agent", n);
const ev = (n: number) => makeId("event", n);
const R = DEFAULT_BAND_RULES;

const cand = (n: number, over: Partial<BandCandidate> = {}): BandCandidate => ({
  agent: ag(n),
  ageYears: 28,
  strength: 0.8,
  desperation: 0.9,
  villageLoyalty: 0,
  ...over,
});

const candidates = fc.array(
  fc.record({
    age: fc.integer({ min: 5, max: 80 }),
    desp: fc.double({ min: 0, max: 1, noNaN: true }),
    loy: fc.double({ min: 0, max: 1, noNaN: true }),
  }),
  { minLength: 0, maxLength: 14 },
);
const toCands = (xs: { age: number; desp: number; loy: number }[]): BandCandidate[] =>
  xs.map((x, i) => ({
    agent: ag(i + 1),
    ageYears: x.age,
    strength: ageStrength(x.age),
    desperation: x.desp,
    villageLoyalty: x.loy,
  }));

function band(n = 4): Band {
  const f = gatherFounders(
    Array.from({ length: n }, (_, i) => cand(i + 1, { strength: 0.9 - i * 0.05 })),
    () => 1,
    Rng.root(1),
    { ...R, minFounders: 2 },
  );
  if (!f) throw new Error("sin banda");
  return foundBand({
    id: makeId("org", 1),
    settlement: makeId("settlement", 1),
    founding: f,
    originEventId: ev(1),
    bornOf: ev(1),
    at: 0,
    rules: R,
  });
}

describe("sim/org/band: decisiones puras", () => {
  it("la sucesión solo toma juramentados activos, conserva tesoro y desempata por id", () => {
    let b = band(8);
    b = leaveBand(b, leaderOf(b) as AgentId, { at: 3, kind: "death", event: ev(2) });
    b = joinBand(b, ag(99), "captured", 3, ev(3), R);
    const crew = memberAgents(b).filter((a) => a !== ag(99));
    const candidates = [
      ...crew.map((agent) => ({ agent, strength: 0.5 })),
      { agent: ag(99), strength: 1 },
      { agent: ag(100), strength: 1 },
    ];
    const who = chooseBandSuccessor(b, candidates, R) as AgentId;
    expect(who).toBe([...crew].sort()[0]);
    expect(chooseBandSuccessor(b, [...candidates].reverse(), R)).toBe(who);
    const next = succeedBand(b, who, 4, ev(4));
    expect(leaderOf(next)).toBe(who);
    expect(next.loyalty).toBe(b.loyalty);
    expect(treasuryOf(next)).toBe(treasuryOf(b));
    expect(memberAgents(next)).toEqual(memberAgents(b));
    expect(bandViolations(next, 0)).toEqual([]);
    expect(succeedBand(next, ag(100), 5, ev(5))).toBe(next);
    expect(chooseBandSuccessor({ ...b, loyalty: { toward: {} } }, candidates, R)).toBeNull();
  });
  it("el cabecilla es el más fuerte y desesperado, con desempate por id", () => {
    const l = chooseLeader([cand(3, { strength: 0.5 }), cand(2), cand(1)], R);
    expect(l?.agent).toBe(ag(1));
    expect(chooseLeader([cand(1, { desperation: 0.1 })], R)).toBeNull();
  });

  it("jurar: el hambre empuja, la lealtad al consejo frena", () => {
    expect(joinChance(cand(1, { desperation: 1 }), 0)).toBeGreaterThan(
      joinChance(cand(1, { desperation: 0.5 }), 0),
    );
    expect(joinChance(cand(1, { villageLoyalty: 1 }), 0)).toBeLessThan(
      joinChance(cand(1, { villageLoyalty: 0 }), 0),
    );
    expect(joinChance(cand(1), 1)).toBeGreaterThan(joinChance(cand(1), 0));
  });

  it("fast-check: formarse es determinista, respeta los topes y sale de candidatos", () => {
    fc.assert(
      fc.property(candidates, fc.integer({ min: 1, max: 1000 }), (xs, seed) => {
        const cs = toCands(xs);
        const run = () => gatherFounders(cs, () => 0.5, Rng.root(seed), R);
        const a = run();
        expect(JSON.stringify(a)).toBe(JSON.stringify(run()));
        if (a) {
          const all = [a.leader, ...a.sworn];
          expect(all.length).toBeGreaterThanOrEqual(R.minFounders);
          expect(all.length).toBeLessThanOrEqual(R.maxMembers);
          expect(new Set(all.map((c) => c.agent)).size).toBe(all.length);
          for (const c of all) {
            expect(c.ageYears).toBeGreaterThanOrEqual(R.minAge);
            expect(c.desperation).toBeGreaterThanOrEqual(R.minDesperation);
          }
        }
      }),
      { numRuns: 60 },
    );
  });

  it("raidChance acotada y creciente con la fuerza", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 20, noNaN: true }),
        fc.double({ min: 0, max: 20, noNaN: true }),
        (a, d) => {
          const p = raidChance(a, d);
          expect(p).toBeGreaterThanOrEqual(0.05);
          expect(p).toBeLessThanOrEqual(0.95);
          expect(raidChance(a + 1, d)).toBeGreaterThanOrEqual(p);
        },
      ),
    );
  });

  it("el botín nunca deja al hogar por debajo de lo que conserva", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 200_000 }),
        fc.integer({ min: 0, max: 500_000 }),
        fc.integer({ min: 0, max: 200_000 }),
        (want, stock, keep) => {
          const l = raidLoot(want, stock, keep);
          expect(l).toBeGreaterThanOrEqual(0);
          expect(l).toBeLessThanOrEqual(want);
          if (l > 0) expect(stock - l).toBeGreaterThanOrEqual(keep);
        },
      ),
    );
  });

  it("el reparto nunca gasta más que el tesoro", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 30 }),
        (t, n, days) => {
          const o = shareOut(t, n, days, R);
          expect(o.each * n).toBeLessThanOrEqual(t);
          expect(o.fed).toBe(o.each >= R.ration * days);
        },
      ),
    );
  });

  it("la desesperación sube cuando baja la despensa", () => {
    expect(desperation(0)).toBe(1);
    expect(desperation(14)).toBe(0);
    expect(desperation(3)).toBeGreaterThan(desperation(10));
  });

  it("solo deserta quien tiene poca lealtad", () => {
    for (let s = 1; s < 30; s++) expect(deserts(0.9, Rng.root(s), R)).toBe(false);
    expect([...Array(60).keys()].some((s) => deserts(0.05, Rng.root(s + 1), R))).toBe(true);
  });
});

describe("sim/org/band: ciclo de vida", () => {
  it("una banda recién fundada cumple las reglas y tiene un cabeza", () => {
    const b = band();
    expect(bandViolations(b, 0)).toEqual([]);
    expect(leaderOf(b)).toBe(ag(1));
    expect(b.org.template).toBe("bandit_band");
  });

  it("jurar y capturar suman miembros (con tope) y salir los cierra con causa", () => {
    let b = band(3);
    b = joinBand(b, ag(9), "sworn", 5, ev(2), R);
    b = joinBand(b, ag(10), "captured", 6, ev(3), R);
    expect(memberAgents(b)).toContain(ag(10));
    expect(b.org.members.find((m) => m.agent === ag(10))?.via).toBe("captured");
    expect(joinBand(b, ag(9), "sworn", 7, ev(4), R)).toBe(b);
    b = leaveBand(b, ag(10), { at: 8, kind: "desertion", event: ev(5) });
    expect(memberAgents(b)).not.toContain(ag(10));
    expect(bandViolations(b, 0)).toEqual([]);
  });

  it("cae el cabeza: se disuelve, el puesto queda vacante con su causa", () => {
    let b = band(3);
    b = leaveBand(b, leaderOf(b) as AgentId, { at: 3, kind: "death", event: ev(7) });
    expect(dissolveReason(b, { leaderAlive: false, members: 2, now: 3, day: 10 }, R)).toBe(
      "leader_fell",
    );
    b = dissolveBand(b, 3, ev(8), "leader_fell");
    expect(b.org.status).toBe("dissolved");
    expect(memberAgents(b)).toEqual([]);
    expect(bandViolations(b, 0)).toEqual([]);
  });

  it("razones de disolución: pocos, hambre larga y fin de la hambruna", () => {
    const b = band(4);
    const c = { leaderAlive: true, members: 4, now: 1000, day: 10 };
    expect(dissolveReason(b, c, R)).toBeNull();
    expect(dissolveReason(b, { ...c, members: 2 }, R)).toBe("too_few");
    expect(dissolveReason({ ...b, unfedDays: R.dissolveUnfedDays }, c, R)).toBe("starved");
    expect(dissolveReason({ ...b, peaceSince: 1000 - R.peaceDays * 10 }, c, R)).toBe("famine_over");
    expect(dissolveReason({ ...b, peaceSince: 1000 - 10 }, c, R)).toBeNull();
  });

  it("el tesoro es lo asaltado menos lo repartido; repartir de más es violación", () => {
    const b = { ...band(), looted: 100, paid: 40 };
    expect(treasuryOf(b)).toBe(60);
    expect(bandViolations(b, 60)).toEqual([]);
    expect(bandViolations(b, 61)).not.toEqual([]);
    expect(bandViolations({ ...b, paid: 101 }, -1)).not.toEqual([]);
  });
});
