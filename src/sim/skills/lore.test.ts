import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadContent } from "../../core/index.ts";
import { ACTIONS, PLANS } from "../actions/index.ts";
import { TRAITS } from "../family/index.ts";
import {
  effectiveKnowledge,
  type Learner,
  type LoreFact,
  learnLore,
  loreMeasure,
  lorePenalty,
  SKILLS,
  syncKnowledge,
  testLore,
} from "./index.ts";

const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const content = loadContent(
  [ACTIONS, PLANS, SKILLS, TRAITS],
  [
    { kind: "actions", file: "a.json", data: json("content/actions/core.json") },
    { kind: "skills", file: "s.json", data: json("content/skills/core.json") },
    { kind: "traits", file: "t.json", data: json("content/traits/human.json") },
  ],
);
const medicine = content.all(SKILLS).find((s) => s.id === "medicine");
if (!medicine) throw new Error("sin medicina");
const adult: Learner = { z: {}, capabilities: {}, ageYears: 30 };
const facts: LoreFact[] = [
  { id: "ginseng_fever", skill: "medicine", truth: true, weight: 2 },
  { id: "moss_bleeding", skill: "medicine", truth: false, weight: 1 },
  { id: "other", skill: "smithing", truth: true, weight: 5 },
];
const told = (tick: number) => ({ kind: "told" as const, from: "agent:2", tick });

describe("saber explícito como creencias", () => {
  it("lo acertado suma, lo equivocado resta y lo ajeno al dominio no cuenta", () => {
    const right = learnLore(undefined, "ginseng_fever", true, { kind: "own", tick: 1 }, 1);
    const both = learnLore(right, "moss_bleeding", true, told(2), 1);
    expect(loreMeasure(right, facts, "medicine")).toBeGreaterThan(0);
    expect(loreMeasure(both, facts, "medicine")).toBeLessThan(
      loreMeasure(right, facts, "medicine"),
    );
    expect(loreMeasure(undefined, facts, "medicine")).toBe(0);
  });

  it("creer que algo falso es falso es acertar", () => {
    const l = learnLore(undefined, "moss_bleeding", false, { kind: "own", tick: 1 }, 1);
    expect(loreMeasure(l, facts, "medicine")).toBeGreaterThan(0);
  });

  it("repetir una fuente confirma; probarlo y que falle da vuelta lo equivocado", () => {
    let l = learnLore(undefined, "moss_bleeding", true, told(1), 0.5);
    const c1 = l.beliefs[0]?.confidence ?? 0;
    l = learnLore(l, "moss_bleeding", true, told(2), 0.5);
    expect(l.beliefs[0]?.confidence ?? 0).toBeGreaterThan(c1);
    expect(l.beliefs).toHaveLength(1);
    l = testLore(l, "moss_bleeding", false, 3, 1);
    l = testLore(l, "moss_bleeding", false, 4, 1);
    expect(l.beliefs[0]?.holds).toBe(false);
    expect(loreMeasure(l, facts, "medicine")).toBeGreaterThan(0);
  });

  it("la faceta se deriva de las creencias y las equivocadas restan al usarse", () => {
    const l = learnLore(
      learnLore(undefined, "ginseng_fever", true, { kind: "own", tick: 1 }, 1),
      "moss_bleeding",
      true,
      { kind: "own", tick: 2 },
      1,
    );
    const st = syncKnowledge(medicine, undefined, l, facts, adult);
    expect(st?.facets.knowledge?.level).toBeGreaterThan(0);
    const pen = lorePenalty(l, facts, ["moss_bleeding"]);
    expect(pen).toBeGreaterThan(0.5);
    expect(lorePenalty(l, facts, ["ginseng_fever"])).toBe(0);
    const level = st?.facets.knowledge?.level ?? 0;
    expect(effectiveKnowledge(level, pen)).toBeLessThan(level);
    expect(effectiveKnowledge(level, 0)).toBe(level);
  });

  it("es determinista y no toca habilidades sin faceta de saber", () => {
    const strike = content.all(SKILLS).find((s) => !s.facets.includes("knowledge"));
    if (!strike) throw new Error("todas tienen saber");
    expect(syncKnowledge(strike, undefined, undefined, facts, adult)).toBeUndefined();
    const a = learnLore(undefined, "ginseng_fever", true, told(1), 0.7);
    expect(a).toEqual(learnLore(undefined, "ginseng_fever", true, told(1), 0.7));
  });
});
