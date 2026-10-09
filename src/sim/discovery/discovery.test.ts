import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type AgentId, type EventId, Rng } from "../../core/index.ts";
import {
  bucketOf,
  CONFIRMATION_BIAS,
  candidateClaims,
  claimId,
  dominant,
  FIELD_YIELD,
  GENERATE_AFTER,
  type LawBelief,
  type LawClaim,
  MIN_WEIGHT,
  type Observation,
  observe,
  type PerceivedSituation,
  PLAYER_PRIOR,
  perceiveYield,
  predict,
  priorBelief,
  proposeHypothesis,
  updateWeights,
  wonder,
  type YieldOutcome,
} from "./index.ts";

const ME = "agent:1" as unknown as AgentId;
const ev = (n: number) => n as unknown as EventId;

function obs(n: number, situation: PerceivedSituation, outcome: YieldOutcome): Observation {
  return {
    id: `${ME}@${n}`,
    observer: ME,
    key: FIELD_YIELD,
    eventId: ev(n),
    at: n * 3600,
    situation,
    outcome,
    confidence: 0.85,
    delay: 0,
    deliberate: false,
  };
}

/** La ley verdadera de los tests: rinde bien en los tramos 1-2 del año; la luna no importa. */
const TRUTH: LawClaim = { kind: "depends", on: "season", high: [1, 2] };

function draw(rng: Rng): { situation: PerceivedSituation; outcome: YieldOutcome } {
  const situation = { season: rng.int(0, 3), moon: rng.int(0, 3) };
  const p = predict(TRUTH, situation);
  const x = rng.float();
  const outcome: YieldOutcome = x < p.poor ? "poor" : x < p.poor + p.fair ? "fair" : "good";
  return { situation, outcome };
}

/** Una creencia que incluye todo el catálogo, para medir si la evidencia favorece a la verdadera. */
function fullBelief(): LawBelief {
  const prior = priorBelief(FIELD_YIELD, Rng.root(1), 0);
  const claims = candidateClaims(FIELD_YIELD);
  const w = 1 / claims.length;
  return {
    ...prior,
    hypotheses: claims.map((c) => ({
      h: {
        id: claimId(FIELD_YIELD, c),
        key: FIELD_YIELD,
        claim: c,
        falsifiable: c.kind !== "moral",
        origin: { kind: "tradition" },
      },
      weight: w,
    })),
  };
}

const weightOf = (b: LawBelief, c: LawClaim) =>
  b.hypotheses.find((x) => x.h.id === claimId(FIELD_YIELD, c))?.weight ?? 0;

describe("la tradición", () => {
  it("siempre trae «nada» y la explicación moral, suma 1 y es del catálogo", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5000 }), (seed) => {
        const b = priorBelief(FIELD_YIELD, Rng.root(seed), 0);
        const ids = new Set(candidateClaims(FIELD_YIELD).map((c) => claimId(FIELD_YIELD, c)));
        expect(b.hypotheses.every((x) => ids.has(x.h.id) && x.h.origin.kind === "tradition")).toBe(
          true,
        );
        expect(b.hypotheses.some((x) => x.h.claim.kind === "none")).toBe(true);
        expect(b.hypotheses.some((x) => x.h.claim.kind === "moral")).toBe(true);
        expect(b.hypotheses.reduce((s, x) => s + x.weight, 0)).toBeCloseTo(1, 4);
      }),
    );
  });

  it("es determinista y varía entre agentes: la verdad puede faltar", () => {
    const a = priorBelief(FIELD_YIELD, Rng.root(3).fork("x"), 0);
    expect(priorBelief(FIELD_YIELD, Rng.root(3).fork("x"), 0)).toEqual(a);
    const sizes = new Set(
      Array.from(
        { length: 40 },
        (_, i) => priorBelief(FIELD_YIELD, Rng.root(i), 0).hypotheses.length,
      ),
    );
    expect(sizes.size).toBeGreaterThan(1);
  });
});

describe("la actualización", () => {
  it("conserva la masa, respeta el piso y deja quieta la hipótesis no falsable", () => {
    const outcome = fc.constantFrom<YieldOutcome>("poor", "fair", "good");
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(fc.integer({ min: 0, max: 3 }), fc.integer({ min: 0, max: 3 }), outcome),
          { maxLength: 60 },
        ),
        (seq) => {
          let b = fullBelief();
          const moral0 = weightOf(b, { kind: "moral" });
          seq.forEach(([season, moon, o], i) => {
            b = observe(b, obs(i + 1, { season, moon }, o));
          });
          expect(b.hypotheses.reduce((s, x) => s + x.weight, 0)).toBeCloseTo(1, 3);
          expect(weightOf(b, { kind: "moral" })).toBeCloseTo(moral0, 4);
          for (const x of b.hypotheses) {
            if (x.h.falsifiable) expect(x.weight).toBeGreaterThan(MIN_WEIGHT / 2);
          }
          expect(b.seen).toBe(seq.length);
        },
      ),
    );
  });

  it("la misma observación no cuenta dos veces", () => {
    const o = obs(1, { season: 1, moon: 0 }, "good");
    const once = observe(fullBelief(), o);
    expect(observe(once, o)).toEqual(once);
  });

  it("con evidencia independiente la verdadera gana peso siempre y suele dominar", () => {
    let gained = 0;
    let wins = 0;
    const runs = 40;
    for (let seed = 0; seed < runs; seed++) {
      const rng = Rng.root(seed);
      let b = fullBelief();
      const w0 = weightOf(b, TRUTH);
      for (let i = 1; i <= 80; i++) {
        const d = draw(rng.fork("obs", i));
        b = observe(b, obs(i, d.situation, d.outcome));
      }
      if (weightOf(b, TRUTH) > w0) gained++;
      if (dominant(b)?.h.id === claimId(FIELD_YIELD, TRUTH)) wins++;
    }
    expect(gained).toBe(runs);
    expect(wins).toBeGreaterThan(runs * 0.8);
  });

  it("sin la verdad en el espacio, nada la reemplaza: solo baja la confianza en lo pensado", () => {
    const rng = Rng.root(11);
    const without = {
      ...fullBelief(),
      hypotheses: fullBelief().hypotheses.filter((x) => x.h.id !== claimId(FIELD_YIELD, TRUTH)),
    };
    let b: LawBelief = without;
    for (let i = 1; i <= 60; i++) {
      const d = draw(rng.fork("obs", i));
      b = observe(b, obs(i, d.situation, d.outcome));
    }
    expect(b.hypotheses.some((x) => x.h.id === claimId(FIELD_YIELD, TRUTH))).toBe(false);
    expect(b.hypotheses).toHaveLength(without.hypotheses.length);
  });

  it("el sesgo de confirmación frena al dominante cuando la evidencia lo contradice", () => {
    const id = claimId(FIELD_YIELD, TRUTH);
    let hs = [...fullBelief().hypotheses];
    for (let i = 0; i < 24; i++) {
      const season = i % 4;
      hs = updateWeights(
        hs,
        obs(
          i,
          { season, moon: Math.floor(i / 4) % 4 },
          season === 1 || season === 2 ? "good" : "poor",
        ),
        0,
      );
    }
    const top = [...hs].sort((a, b) => b.weight - a.weight)[0];
    expect(top?.h.id).toBe(id);
    const bad = obs(99, { season: 1, moon: 0 }, "poor");
    const free = updateWeights(hs, bad, 0).find((x) => x.h.id === id)?.weight ?? 0;
    const biased =
      updateWeights(hs, bad, CONFIRMATION_BIAS + 0.2).find((x) => x.h.id === id)?.weight ?? 0;
    expect(biased).toBeGreaterThan(free);
  });
});

describe("otras explicaciones", () => {
  it("se le ocurren con anomalías y el dominante flojo, del catálogo y por lo que anotó", () => {
    const rng = Rng.root(5);
    const base = fullBelief().hypotheses.filter(
      (x) => x.h.claim.kind === "none" || x.h.claim.kind === "moral",
    );
    // Cree que no depende de nada, pero anotó que los tramos 1 y 2 rinden y el 3 no.
    let b: LawBelief = {
      ...fullBelief(),
      hypotheses: base.map((x) => ({ ...x, weight: x.h.claim.kind === "none" ? 0.55 : 0.45 })),
      anomalies: [],
    };
    expect(wonder(b, rng, ev(1))).toBe(b);
    let n = 0;
    for (let i = 0; i < 400 && b.hypotheses.length === 2; i++) {
      b = {
        ...b,
        evidence: [
          ...b.evidence,
          obs(++n, { season: 1 + (n % 2), moon: n % 4 }, "good"),
          obs(++n, { season: 3, moon: n % 4 }, "poor"),
        ].slice(-30),
        anomalies: Array.from({ length: GENERATE_AFTER }, (_, k) => `a${k}`),
      };
      b = wonder(b, rng.fork("w", i), ev(100 + i));
    }
    expect(b.hypotheses).toHaveLength(3);
    const ids = new Set(candidateClaims(FIELD_YIELD).map((c) => claimId(FIELD_YIELD, c)));
    const fresh = b.hypotheses.find((x) => x.h.origin.kind === "generated");
    expect(fresh && ids.has(fresh.h.id)).toBe(true);
    expect(fresh?.h.claim.kind).toBe("depends");
    expect(b.hypotheses.reduce((s, x) => s + x.weight, 0)).toBeCloseTo(1, 4);
  });
});

describe("el jugador propone", () => {
  it("entra con origen player y poco peso, y repetirla no cambia nada", () => {
    const all = fullBelief();
    const base: LawBelief = {
      ...all,
      hypotheses: all.hypotheses
        .filter((x) => x.h.claim.kind !== "depends")
        .map((x) => ({ ...x, weight: 0.5 })),
    };
    const claim = TRUTH;
    const b = proposeHypothesis(base, claim, ev(7));
    const entry = b.hypotheses.find((x) => x.h.id === claimId(FIELD_YIELD, claim));
    expect(entry?.h.origin).toEqual({ kind: "player", eventId: ev(7) });
    expect(entry?.weight).toBeCloseTo(PLAYER_PRIOR, 4);
    expect(proposeHypothesis(b, claim, ev(8))).toEqual(b);
  });

  it("no acepta lo que el catálogo no permite formular", () => {
    expect(() =>
      proposeHypothesis(fullBelief(), { kind: "depends", on: "season", high: [0, 2] }, ev(1)),
    ).toThrow(RangeError);
  });
});

describe("lo que se percibe", () => {
  it("el rinde se clasifica en orden y los tramos son del 0 al 3", () => {
    const rank = { poor: 0, fair: 1, good: 2 } as const;
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 300 }), fc.integer({ min: 0, max: 300 }), (a, b) => {
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        const x = rank[perceiveYield(lo, 110, Rng.root(4))];
        const y = rank[perceiveYield(hi, 110, Rng.root(4))];
        expect(y).toBeGreaterThanOrEqual(x);
      }),
    );
    fc.assert(
      fc.property(fc.double({ min: -3, max: 3, noNaN: true }), (p) => {
        const k = bucketOf(p);
        expect(k).toBeGreaterThanOrEqual(0);
        expect(k).toBeLessThanOrEqual(3);
      }),
    );
  });
});
