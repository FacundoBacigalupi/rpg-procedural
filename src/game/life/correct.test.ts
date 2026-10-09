import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type AgentId, EARTHLIKE_CLOCK, loadContent } from "../../core/index.ts";
import {
  ACTIONS,
  BODY_STATE,
  ENTITY,
  LOCATION,
  PERSON,
  PLANS,
  type ReadonlyWorldTruth,
  SKILL_STATE,
  SKILLS,
  SkillCatalog,
  type SkillState,
  TRAITS,
} from "../../sim/index.ts";
import { masterOf } from "./correct.ts";

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
const use = catalog.forVerb("cook");
if (!use) throw new Error("cook sin habilidad");
const skillId = use.skill.id;

const at = (level: number): SkillState => ({
  facets: Object.fromEntries(use.skill.facets.map((f) => [f, { level, peak: level }])),
  hours: 100,
  lastPracticed: 0,
});

interface P {
  household?: string;
  ageYears?: number;
  hex?: number;
  level: number;
  sleeping?: boolean;
}

function world(people: Record<string, P>): ReadonlyWorldTruth {
  const rows = (name: string, id: string): unknown => {
    const p = people[id];
    if (!p) return undefined;
    if (name === PERSON.name) {
      return { household: p.household ?? "h1", born: -(p.ageYears ?? 30) * EARTHLIKE_CLOCK.year };
    }
    if (name === LOCATION.name) return { hex: p.hex ?? 5 };
    if (name === BODY_STATE.name) return { activity: p.sleeping ? "sleep" : "light" };
    if (name === SKILL_STATE.name) return { [skillId]: at(p.level) };
    if (name === ENTITY.name) return {};
    return undefined;
  };
  return {
    get: (t: { name: string }, id: string) => rows(t.name, id),
    ids: () => Object.keys(people),
  } as unknown as ReadonlyWorldTruth;
}

const base = (truth: ReadonlyWorldTruth) => ({
  truth,
  catalog,
  traits: [],
  plans: new Map(),
  clock: EARTHLIKE_CLOCK,
  cook: "cook" as AgentId,
  verb: "cook",
  defects: [{ kind: "raw" as const, severity: 0.8 }],
  hex: 5,
  seconds: 1800,
  expected: 0.5,
  now: 0,
});

describe("el maestro que corrige", () => {
  it("elige al adulto de la casa que sabe claramente más, presente y despierto", () => {
    const t = world({
      cook: { level: 0.2, ageYears: 12 },
      mother: { level: 0.7 },
      father: { level: 0.5 },
    });
    expect(masterOf(base(t))?.id).toBe("mother");
  });

  it("no corrige quien sabe lo mismo, duerme, está en otro hex o es de otra casa", () => {
    const t = world({
      cook: { level: 0.4, ageYears: 12 },
      equal: { level: 0.45 },
      asleep: { level: 0.9, sleeping: true },
      far: { level: 0.9, hex: 9 },
      stranger: { level: 0.9, household: "h2" },
    });
    expect(masterOf(base(t))).toBeNull();
  });

  it("un chico no es maestro", () => {
    const t = world({ cook: { level: 0.1, ageYears: 8 }, kid: { level: 0.9, ageYears: 10 } });
    expect(masterOf(base(t))).toBeNull();
  });
});
