import { describe, expect, it } from "vitest";
import { Rng } from "../../core/index.ts";
import {
  aversion,
  type Candidate,
  choiceOdds,
  type Drives,
  decideByUtility,
  gainOf,
  rank,
  temperature,
  utilityOf,
} from "./utility.ts";

const eat: Candidate = { id: "eat", verb: "eat", contributes: { hunger: 1 }, chance: 0.95 };
const sleep: Candidate = { id: "sleep", verb: "sleep", contributes: { rest: 1 }, chance: 0.95 };
const study: Candidate = { id: "study", verb: "study", contributes: { knowledge: 1 }, chance: 0.8 };
const bold = { boldness: 0.5 };

const hungry: Drives = { needs: { hunger: 0.9, rest: 0.1 }, values: { knowledge: 0.3 } };
const rested: Drives = { needs: { hunger: 0, rest: 0 }, values: { knowledge: 0.5, family: 0.5 } };

describe("utilidad de los NPC", () => {
  it("la necesidad apremiante gana a la que no", () => {
    const [first] = rank([study, sleep, eat], hungry, bold);
    expect(first?.candidate.id).toBe("eat");
  });

  it("con las necesidades saciadas mandan los valores", () => {
    const [first] = rank([eat, sleep, study], rested, bold);
    expect(first?.candidate.id).toBe("study");
    expect(gainOf(eat, rested)).toBe(0);
  });

  it("el riesgo creído resta más a quien tiene menos audacia", () => {
    const risky: Candidate = { ...study, risk: 0.5 };
    expect(utilityOf(risky, rested, { boldness: 0 })).toBeLessThan(
      utilityOf(risky, rested, { boldness: 1 }),
    );
    expect(aversion(1, 0)).toBeLessThan(aversion(1, 1));
  });

  it("la chance baja la utilidad y el fracaso cuesta", () => {
    const sure = utilityOf({ ...study, chance: 1 }, rested, bold);
    const dicey = utilityOf({ ...study, chance: 0.4, loss: 0.2 }, rested, bold);
    expect(dicey).toBeLessThan(sure);
  });

  it("el control baja la temperatura y concentra la elección", () => {
    expect(temperature({ control: 1 })).toBeLessThan(temperature({ control: 0 }));
    const scored = rank([eat, sleep, study], hungry, bold);
    const calm = choiceOdds(scored, temperature({ control: 1 }));
    const hot = choiceOdds(scored, temperature({ control: 0 }));
    expect(calm[0] as number).toBeGreaterThan(hot[0] as number);
    expect(calm.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });

  it("decide es determinista por seed y clave, y a veces elige la segunda", () => {
    const pick = (seed: number, tick: number) =>
      decideByUtility(
        [eat, sleep, study],
        hungry,
        { control: 0 },
        bold,
        Rng.root(seed).fork("decision", "npc:1", tick),
      )?.candidate.id;
    expect(pick(7, 100)).toBe(pick(7, 100));
    const seen = new Set<string | undefined>();
    for (let t = 0; t < 200; t++) seen.add(pick(7, t));
    expect(seen.has("eat")).toBe(true);
    expect(seen.size).toBeGreaterThan(1);
    expect(decideByUtility([], hungry, {}, bold, Rng.root(1))).toBeUndefined();
  });
});
