import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type AgentId, Rng } from "../../core/index.ts";
import {
  type Appeal,
  appealKey,
  chooseAppeal,
  claimCredibility,
  faceCostOf,
  NO_STAKES,
  nextStance,
  OFFEND_AT,
  openness,
  type PersuasionInput,
  persuade,
  relevance,
  type Stakes,
} from "./persuasion.ts";

const bruno = "agent:2" as AgentId;
const carla = "agent:3" as AgentId;

const stakes: Stakes = {
  ...NO_STAKES,
  values: { loyalty: 0.9, thrift: -0.8 },
  relations: { [bruno]: 0.7 },
  face: { [carla]: 0.8 },
};

const base: PersuasionInput = {
  argument: { claim: "danger.sect", appealsTo: { kind: "value", value: "loyalty" } },
  stakes,
  plausibility: 0.8,
  speaker: {
    trust: 0.5,
    standing: 0,
    reputation: 0.5,
    execution: 0.8,
    judgment: 0.6,
    reading: 0.5,
  },
  listener: { intellect: 0.6, stubbornness: 0.2, anger: 0, pride: 0.5 },
  stance: 0,
  witnesses: 0,
  gap: 0.15,
  attempts: 0,
};

const seeds = fc.nat();
const rngOf = (seed: number) => Rng.root(seed).fork("persuasion");
const appealing = (appealsTo: Appeal): PersuasionInput => ({
  ...base,
  argument: { ...base.argument, appealsTo },
});

describe("relevancia", () => {
  it("solo pesa lo que al oyente le importa", () => {
    expect(relevance({ kind: "value", value: "loyalty" }, stakes)).toBe(0.9);
    expect(relevance({ kind: "value", value: "justice" }, stakes)).toBe(0);
    expect(relevance({ kind: "value", value: "thrift" }, stakes)).toBe(0);
    expect(relevance({ kind: "relation", with: bruno }, stakes)).toBe(0.7);
  });

  it("las claves de apelativo son estables y distintas", () => {
    const keys: Appeal[] = [
      { kind: "goal", goal: "a" },
      { kind: "value", value: "a" },
      { kind: "norm", norm: "a" },
      { kind: "fear", danger: "a" },
      { kind: "authority", source: "a" },
      { kind: "reciprocity", favor: "a" },
      { kind: "relation", with: bruno },
      { kind: "face", whose: bruno },
    ];
    expect(new Set(keys.map(appealKey)).size).toBe(keys.length);
  });
});

describe("credibilidad", () => {
  it("la evidencia sube la credibilidad y el hablante de confianza la afirma", () => {
    const sin = claimCredibility(0.3, [], 0.5);
    const con = claimCredibility(0.3, [{ strength: 0.8 }], 0.5);
    expect(con).toBeGreaterThan(sin);
    expect(claimCredibility(0.3, [], 0.9)).toBeGreaterThan(claimCredibility(0.3, [], 0.1));
  });
});

describe("apertura y cara", () => {
  it("el enojado y el terco escuchan menos", () => {
    const calm = { intellect: 0.5, stubbornness: 0.2, anger: 0, pride: 0.5 };
    expect(openness({ ...calm, anger: 0.8 }, 0)).toBeLessThan(openness(calm, 0));
    expect(openness({ ...calm, stubbornness: 0.9 }, 0)).toBeLessThan(openness(calm, 0));
    expect(openness(calm, 0.9)).toBeLessThan(openness(calm, 0));
  });

  it("a solas no cuesta cara; con testigos y posición pública sí; la salida lo alivia", () => {
    expect(faceCostOf(0.9, 0, 0.8, 0)).toBe(0);
    const seen = faceCostOf(0.9, 5, 0.8, 0);
    expect(seen).toBeGreaterThan(0.5);
    expect(faceCostOf(0.9, 5, 0.8, 0.8)).toBeLessThan(seen);
    expect(faceCostOf(0.9, 5, 0.1, 0)).toBeLessThan(seen);
  });
});

describe("persuadir", () => {
  it("un argumento relevante, creíble y bien dicho convence a quien está cerca", () => {
    fc.assert(
      fc.property(seeds, (seed) => {
        const p = persuade(base, rngOf(seed));
        expect(p.outcome).toBe("moved");
        expect(p.relevance).toBe(0.9);
        expect(p.effects.some((e) => e.kind === "belief")).toBe(true);
      }),
    );
  });

  it("apelar a lo que no le importa no mueve nada", () => {
    fc.assert(
      fc.property(seeds, (seed) => {
        const p = persuade(appealing({ kind: "value", value: "justice" }), rngOf(seed));
        expect(p.relevance).toBe(0);
        expect(p.shift).toBe(0);
        expect(p.outcome).toBe("unmoved");
      }),
    );
  });

  it("apelar a lo que rechaza endurece y baja la confianza", () => {
    fc.assert(
      fc.property(seeds, (seed) => {
        const p = persuade(appealing({ kind: "value", value: "thrift" }), rngOf(seed));
        expect(p.outcome).toBe("offended");
        expect(p.backlash).toBeGreaterThanOrEqual(OFFEND_AT);
        expect(p.trustDelta).toBeLessThan(0);
        expect(nextStance(0.2, p)).toBeGreaterThan(0.2);
        expect(p.effects.some((e) => e.kind === "weight")).toBe(false);
      }),
    );
  });

  it("insistir de más produce reacción", () => {
    fc.assert(
      fc.property(seeds, (seed) => {
        const once = persuade(base, rngOf(seed));
        const nag = persuade({ ...base, attempts: 5, gap: 0.95 }, rngOf(seed));
        expect(nag.backlash).toBeGreaterThan(once.backlash);
        expect(nag.trustDelta).toBeLessThan(once.trustDelta);
      }),
    );
  });

  it("cambiar de opinión con testigos cuesta, y ofrecer la salida lo evita", () => {
    fc.assert(
      fc.property(seeds, (seed) => {
        const witnessed = { ...base, stance: 0.9, witnesses: 6, gap: 0.2 };
        const direct = persuade(witnessed, rngOf(seed));
        const face = persuade(
          {
            ...witnessed,
            argument: { ...base.argument, appealsTo: { kind: "face", whose: carla } },
          },
          rngOf(seed),
        );
        const alone = persuade({ ...witnessed, witnesses: 0 }, rngOf(seed));
        expect(direct.faceCost).toBeGreaterThan(0);
        expect(alone.faceCost).toBe(0);
        expect(face.faceCost).toBeLessThan(direct.faceCost);
      }),
    );
  });

  it("quien cede delante de otros queda sin posición que defender", () => {
    fc.assert(
      fc.property(seeds, (seed) => {
        const p = persuade(
          {
            ...base,
            stance: 0.5,
            witnesses: 6,
            gap: 0.02,
            speaker: { ...base.speaker, execution: 1 },
          },
          rngOf(seed),
        );
        if (p.outcome !== "moved") return;
        expect(nextStance(0.5, p)).toBe(0);
        expect(p.effects.some((e) => e.kind === "emotion" && e.emotion === "shame")).toBe(
          p.faceCost > 0.2,
        );
      }),
    );
  });

  it("si no da vuelta la decisión, igual deja creencias y un peso subido", () => {
    fc.assert(
      fc.property(seeds, (seed) => {
        const p = persuade({ ...base, gap: 0.99 }, rngOf(seed));
        expect(p.outcome).toBe("swayed");
        expect(p.effects.find((e) => e.kind === "weight")).toMatchObject({ key: "value:loyalty" });
      }),
    );
  });

  it("el miedo como apelativo deja miedo", () => {
    const p = persuade(
      {
        ...base,
        stakes: { ...NO_STAKES, dangers: { sect: 0.9 } },
        argument: { claim: "danger.sect", appealsTo: { kind: "fear", danger: "sect" } },
      },
      rngOf(1),
    );
    expect(p.effects.some((e) => e.kind === "emotion" && e.emotion === "fear")).toBe(true);
  });

  it("es determinista", () => {
    fc.assert(
      fc.property(seeds, (seed) => {
        expect(persuade(base, rngOf(seed))).toEqual(persuade(base, rngOf(seed)));
      }),
    );
  });
});

describe("elegir el argumento", () => {
  const options: Appeal[] = [
    { kind: "value", value: "thrift" },
    { kind: "value", value: "loyalty" },
    { kind: "value", value: "justice" },
  ];

  it("con buen juicio elige lo que más le importa", () => {
    fc.assert(
      fc.property(seeds, (seed) => {
        expect(chooseAppeal(options, stakes, 1, rngOf(seed))).toBe(1);
      }),
    );
  });

  it("sin candidatos devuelve -1", () => {
    expect(chooseAppeal([], stakes, 0.5, rngOf(1))).toBe(-1);
  });
});
