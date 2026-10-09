import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { EARTHLIKE_CLOCK, loadContent, makeId } from "../../core/index.ts";
import { ACTIONS, PLANS } from "../actions/index.ts";
import { TRAITS } from "../family/index.ts";
import {
  type HouseholdMember,
  intendedSkills,
  resolveIntents,
  SKILLS,
  SkillCatalog,
  type Skills,
  type TeacherRole,
  teachingFeedback,
  UpbringingSpec,
  upbringingSkills,
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
const clock = EARTHLIKE_CLOCK;
const YEAR = clock.year;

const dad = makeId("agent", 1);
const mom = makeId("agent", 2);
const kid = makeId("agent", 3);
const gran = makeId("agent", 4);
const born = 40 * YEAR;
const person = (b: number, mother: typeof mom | null, father: typeof dad | null) => ({
  sex: "male" as const,
  born: b,
  mother,
  father,
});
const home: HouseholdMember[] = [
  { id: dad, person: person(10 * YEAR, gran, null) },
  { id: mom, person: person(12 * YEAR, null, null) },
  { id: gran, person: person(-20 * YEAR, null, null) },
];
const child: HouseholdMember = { id: kid, person: person(born, mom, dad) };

const taught = (by: TeacherRole, skill = "brawling") =>
  UpbringingSpec.parse({ kind: "taught", skill, by, fromAge: 6, toAge: 12 });
const brawling = () => catalog.skill("brawling") as NonNullable<ReturnType<SkillCatalog["skill"]>>;
const sum = (s: Skills | undefined, id: string) =>
  Object.values(s?.[id]?.facets ?? {}).reduce((a, f) => a + f.level, 0);

describe("infancia elegida como intenciones del hogar", () => {
  it("resuelve el rol contra gente real del hogar", () => {
    const r = resolveIntents(
      [taught("father"), taught("mother", "cooking"), taught("grandparent", "farming")],
      child,
      home,
      catalog,
      clock,
    );
    expect(r.rejected).toEqual([]);
    expect(r.intents.map((i) => i.teacher)).toEqual([dad, mom, gran]);
  });

  it("rechaza lo que el hogar no puede cumplir, con la razón", () => {
    const backwards = UpbringingSpec.parse({
      kind: "taught",
      skill: "farming",
      by: "mother",
      fromAge: 6,
      toAge: 3,
    });
    const r = resolveIntents(
      [taught("father"), taught("mother", "nope"), backwards],
      child,
      home.filter((m) => m.id !== dad),
      catalog,
      clock,
    );
    expect(r.intents).toEqual([]);
    expect(r.rejected.map((x) => x.spec)).toEqual([0, 1, 2]);
    expect(r.rejected[0]?.reason).toMatch(/no hay en el hogar/);
    expect(r.rejected[1]?.reason).toMatch(/no es una habilidad/);
  });

  it("un adulto demasiado chico a esa edad no enseña", () => {
    const young: HouseholdMember = { id: dad, person: person(born - 5 * YEAR, gran, null) };
    const r = resolveIntents([taught("father")], child, [young], catalog, clock);
    expect(r.intents).toEqual([]);
  });

  it("la intención sube la habilidad por encima de la crianza de aldea", () => {
    const z = {};
    const now = born + 14 * YEAR;
    const base = upbringingSkills(catalog, z, born, now, clock);
    const { intents } = resolveIntents([taught("father")], child, home, catalog, clock);
    const level = { level: 0.8, peak: 0.8 };
    const master: Skills = {
      brawling: {
        facets: { execution: level, reading: level, judgment: level },
        hours: 5000,
        lastPracticed: 0,
      },
    };
    const good = intendedSkills(catalog, z, born, now, clock, intents, new Map([[dad, master]]));
    const crude = intendedSkills(catalog, z, born, now, clock, intents, new Map());
    expect(sum(good, "brawling")).toBeGreaterThan(sum(base, "brawling"));
    expect(sum(good, "brawling")).toBeGreaterThan(sum(crude, "brawling"));
    expect(teachingFeedback(brawling(), master)).toBeGreaterThan(
      teachingFeedback(brawling(), undefined),
    );
  });

  it("es determinista y los niveles quedan en [0, 1] (fast-check)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 3, max: 20 }), fc.integer({ min: 20, max: 1500 }), (age, h) => {
        const spec = UpbringingSpec.parse({
          kind: "taught",
          skill: "medicine",
          by: "either_parent",
          fromAge: 4,
          toAge: 10,
          hoursPerYear: h,
        });
        const { intents } = resolveIntents([spec], child, home, catalog, clock);
        const run = () =>
          intendedSkills(
            catalog,
            { intellect: 0.5 },
            born,
            born + age * YEAR,
            clock,
            intents,
            new Map(),
          );
        const a = run();
        expect(a).toEqual(run());
        for (const s of Object.values(a))
          for (const f of Object.values(s.facets)) {
            expect(f.level).toBeGreaterThanOrEqual(0);
            expect(f.level).toBeLessThanOrEqual(1);
          }
      }),
      { numRuns: 40 },
    );
  });
});
