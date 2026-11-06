import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type AgentId, type EventId, Rng } from "../../core/index.ts";
import type { Trait } from "../family/index.ts";
import { absorbDraw, absorbWant, mixedPurity, regrown, rootMatch } from "./absorb.ts";
import { breakChance, breakOutcome, breakPreparation } from "./breakthrough.ts";
import { generateCultivationLaw, QI_THRESHOLDS } from "./law.ts";
import type { PlaceQi } from "./meditation.ts";
import { aptitudeOf, talentOf } from "./talent.ts";

const talents = JSON.parse(readFileSync("content/talents/human.json", "utf8")) as Trait[];
const FIVE = { id: "five_phases", elements: ["wood", "fire", "earth", "metal", "water"] };
const E = "event:1" as EventId;
const lawOf = (seed: number) =>
  generateCultivationLaw(Rng.root(seed).fork("cultivation", "law"), FIVE, E);

describe("la ley del cultivo (novel-cult-law)", () => {
  it("mismo seed, misma ley; otro seed, otra escalera", () => {
    expect(lawOf(7)).toEqual(lawOf(7));
    const ladders = new Set(
      [1, 2, 3, 4, 5, 6].map((s) => JSON.stringify(lawOf(s).paths[0]?.thresholds)),
    );
    expect(ladders.size).toBe(6);
  });

  it("la escalera del qi: saturación, capacidad creciente, cuello de botella acotado", () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const law = lawOf(seed);
      expect(law.originEventId).toBe(E);
      const ts = law.paths[0]?.thresholds ?? [];
      expect(ts.length).toBeGreaterThanOrEqual(QI_THRESHOLDS[0]);
      expect(ts.length).toBeLessThanOrEqual(QI_THRESHOLDS[1]);
      for (const [i, t] of ts.entries()) {
        expect(t.kind).toBe("saturation");
        expect(t.index).toBe(i);
        expect(t.bottleneck).toBeGreaterThanOrEqual(0.1);
        expect(t.bottleneck).toBeLessThanOrEqual(0.95);
        if (i > 0) expect(t.capacity).toBeGreaterThan(ts[i - 1]?.capacity ?? 0);
      }
      expect(law.rootThreshold).toBeGreaterThan(1);
      expect(law.rootThreshold).toBeLessThan(1.7);
    }
  });
});

describe("el talento (novel-cult-law)", () => {
  const people = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      talentOf(talents, i % 2 ? "male" : "female", undefined, Rng.root(9).fork("t", i), E),
    );

  it("la mayoría no tiene raíz; los que sí, entre una y cinco con afinidades que suman 1", () => {
    const law = lawOf(3);
    const apts = people(2000).map((t) => aptitudeOf(law, t.innate));
    const rooted = apts.filter((a) => a.roots.length > 0);
    expect(rooted.length / apts.length).toBeGreaterThan(0.02);
    expect(rooted.length / apts.length).toBeLessThan(0.25);
    for (const a of apts.filter((x) => x.roots.length === 0)) expect(a.rootQuality).toBe(0);
    for (const a of rooted) {
      expect(a.roots.length).toBeLessThanOrEqual(5);
      const sum = a.roots.reduce((s, r) => s + r.affinity, 0);
      expect(sum).toBeCloseTo(1, 2);
      expect(a.rootQuality).toBeGreaterThan(0);
      expect(a.rootQuality).toBeLessThanOrEqual(1);
    }
  });

  it("se hereda: hijos de padres con raíz la tienen más seguido", () => {
    const law = lawOf(3);
    const pool = people(3000);
    const strong = pool.filter((t) => (t.genome.additive["spirit_root"] ?? 0) > 1);
    const weak = pool.filter((t) => (t.genome.additive["spirit_root"] ?? 0) < -0.5);
    const kids = (ps: typeof pool) =>
      ps.slice(0, 120).map((m, i) => {
        const f = ps[(i + 1) % ps.length] ?? m;
        return aptitudeOf(
          law,
          talentOf(
            talents,
            "female",
            {
              mother: { id: `agent:${i}` as AgentId, genome: m.genome },
              father: { id: `agent:${i + 1000}` as AgentId, genome: f.genome },
            },
            Rng.root(11).fork("kid", i),
            E,
          ).innate,
        );
      });
    const share = (xs: ReturnType<typeof kids>) =>
      xs.filter((a) => a.roots.length > 0).length / xs.length;
    expect(share(kids(strong))).toBeGreaterThan(share(kids(weak)) + 0.1);
  });
});

describe("absorber (novel-cult-absorb)", () => {
  const place: PlaceQi = {
    cell: 1,
    level: 1000,
    reference: 1000,
    regenPerYear: 100,
    elements: { fire: 800, water: 200 },
  };
  const apt = (element: string) => ({
    roots: [{ element, affinity: 1 }],
    rootQuality: 0.8,
    meridians: 0.5,
    comprehension: 0.5,
  });

  it("la raíz que se parece al qi del lugar junta más; sin raíz, nada", () => {
    expect(rootMatch(apt("fire"), place)).toBe(1);
    expect(rootMatch(apt("water"), place)).toBeCloseTo(0.4);
    expect(rootMatch({ ...apt("fire"), roots: [] }, place)).toBe(0);
    const fire = absorbWant(apt("fire"), 4, 1, 1, rootMatch(apt("fire"), place));
    const water = absorbWant(apt("water"), 4, 1, 1, rootMatch(apt("water"), place));
    expect(fire).toBeGreaterThan(water);
    expect(absorbWant({ ...apt("fire"), roots: [] }, 4, 1, 1, 1)).toBe(0);
  });

  it("lo que entra lo acotan la celda y el recipiente", () => {
    expect(absorbDraw(50, place, 0, 0, 100)).toBe(50);
    expect(absorbDraw(50, place, 0, 80, 100)).toBe(20);
    expect(absorbDraw(50, place, 990, 0, 100)).toBe(10);
    expect(absorbDraw(50, place, 0, 100, 100)).toBe(0);
  });

  it("la regeneración repone el débito sin pasarse; la pureza es la mezcla", () => {
    const t = { taken: 60, drawn: 60, at: 0 };
    expect(regrown(t, place, 100, 1000).taken).toBe(50);
    expect(regrown(t, place, 100_000, 1000).taken).toBe(0);
    expect(regrown(t, place, 100_000, 1000).drawn).toBe(60);
    expect(mixedPurity(10, 1, 10, 0)).toBe(0.5);
    expect(mixedPurity(0, 0, 5, 0.7)).toBe(0.7);
  });
});

describe("la ruptura (novel-cult-break)", () => {
  const apt = {
    roots: [{ element: "wood", affinity: 1 }],
    rootQuality: 0.8,
    meridians: 0.5,
    comprehension: 0.5,
  };
  const full = { qi: 100, capacity: 100, purity: 1, calm: 1, meridianDamage: 0, foundation: 0 };

  it("la preparación sube con saturación, pureza y calma; los meridianos dañados la bajan", () => {
    const p = breakPreparation(apt, full);
    expect(breakPreparation(apt, { ...full, qi: 50 })).toBeLessThan(p);
    expect(breakPreparation(apt, { ...full, purity: 0.2 })).toBeLessThan(p);
    expect(breakPreparation(apt, { ...full, calm: 0.5 })).toBeLessThan(p);
    expect(breakPreparation(apt, { ...full, meridianDamage: 0.5 })).toBeLessThan(p);
    expect(breakPreparation({ ...apt, roots: [] }, full)).toBe(0);
  });

  it("la probabilidad es monótona en la preparación y en el cuello de botella", () => {
    const xs = [0, 0.2, 0.4, 0.6, 0.8, 1].map((x) => breakChance(x, 0.3));
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1] ?? 0);
    expect(breakChance(0.5, 0.2)).toBeGreaterThan(breakChance(0.5, 0.6));
  });

  it("éxito con calidad por el margen; mal preparado, más retroceso y más duro", () => {
    const ok = breakOutcome(0.9, 0.3, 0, 0);
    expect(ok.kind).toBe("success");
    if (ok.kind === "success") expect(ok.quality).toBeGreaterThan(0.5);
    const backlashes = (prep: number) => {
      let n = 0;
      for (let i = 0; i < 100; i++) {
        if (breakOutcome(prep, 0.6, 0.999, i / 100).kind === "backlash") n++;
      }
      return n;
    };
    expect(backlashes(0.1)).toBeGreaterThan(backlashes(0.5));
    const hard = breakOutcome(0, 0.6, 0.999, 0);
    const soft = breakOutcome(0.55, 0.6, 0.999, 0);
    if (hard.kind === "backlash" && soft.kind === "backlash") {
      expect(hard.lostShare).toBeGreaterThan(soft.lostShare);
    } else throw new Error("se esperaban dos retrocesos");
    expect(breakOutcome(0.55, 0.6, 0.999, 0.99).kind).toBe("stalled");
  });
});
