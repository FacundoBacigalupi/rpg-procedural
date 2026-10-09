import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadContent } from "../../core/index.ts";
import { ACTIONS, PLANS } from "../actions/index.ts";
import { TRAITS } from "../family/index.ts";
import {
  familiarityOf,
  type Learner,
  learnFromWatching,
  levelOf,
  rivalKey,
  SKILLS,
  SkillCatalog,
  type SkillState,
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
const catalog = new SkillCatalog(content.all(SKILLS), content.all(ACTIONS));
const use = catalog.forVerb("strike");
if (!use) throw new Error("strike sin habilidad");
const DAY = 86400;
const adult: Learner = { z: {}, capabilities: {}, ageYears: 25 };
const watched = { doer: "agent:9", seen: 0.8, doerLevel: 0.6, seconds: 3600, tick: 100 };

describe("aprender mirando", () => {
  it("mirar a alguien que sabe más deposita en lectura y saber, y da familiaridad", () => {
    const out = learnFromWatching(use, undefined, adult, watched, DAY);
    expect(out).not.toBeNull();
    const facets = use.skill.facets;
    if (facets.includes("reading")) expect(levelOf(out ?? undefined, "reading")).toBeGreaterThan(0);
    expect(levelOf(out ?? undefined, "execution")).toBe(0);
    expect(familiarityOf(out ?? undefined, rivalKey("agent:9"), 100, DAY)).toBeGreaterThan(0);
    expect(out?.lastPracticed).toBeNull();
  });

  it("no enseña quien sabe lo mismo o menos, ni lo que casi no se vio", () => {
    expect(learnFromWatching(use, undefined, adult, { ...watched, doerLevel: 0 }, DAY)).toBeNull();
    expect(learnFromWatching(use, undefined, adult, { ...watched, seen: 0.05 }, DAY)).toBeNull();
  });

  it("con base la mano también aprende, y ver más enseña más", () => {
    const base: SkillState = {
      facets: { execution: { level: 0.3, peak: 0.3 }, reading: { level: 0.1, peak: 0.1 } },
      hours: 5,
      lastPracticed: 0,
    };
    const a = learnFromWatching(use, base, adult, watched, DAY);
    const b = learnFromWatching(use, base, adult, { ...watched, seen: 0.3 }, DAY);
    expect(levelOf(a ?? undefined, "execution")).toBeGreaterThan(0.3);
    expect(levelOf(a ?? undefined, "reading")).toBeGreaterThan(levelOf(b ?? undefined, "reading"));
    expect(a?.hours).toBe(5);
  });
});
