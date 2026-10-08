import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { EARTHLIKE_CLOCK, loadContent } from "../../core/index.ts";
import { ACTIONS, type Attempt, PLANS } from "../actions/index.ts";
import { TRAITS } from "../family/index.ts";
import {
  LEARNING_EDGE,
  SELF_IMAGES,
  type SelfImages,
  SKILLS,
  SkillCatalog,
  type SkillState,
  seedSelfImages,
  selfBias,
  skillLevel,
  skillStandingOf,
  upbringingSkills,
  updateSelfImage,
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
const YEAR = EARTHLIKE_CLOCK.year;
const farming = catalog.skill("farming") as NonNullable<ReturnType<SkillCatalog["skill"]>>;

const roll = (over: Partial<Attempt>): Attempt => ({
  outcome: "success",
  margin: 1,
  expected: LEARNING_EDGE,
  factors: [],
  failure: null,
  unmet: null,
  noticedBy: [],
  believed: "success",
  cues: [],
  ...over,
});

const verbOf = (skill: string) =>
  content
    .all(ACTIONS)
    .map((v) => v.id)
    .find((id) => catalog.forVerb(id)?.skill.id === skill) as string;

describe("autoimagen de la habilidad", () => {
  it("la siembra es determinista y sale del nivel más el sesgo", () => {
    const st = upbringingSkills(catalog, {}, 0, 30 * YEAR, EARTHLIKE_CLOCK);
    const a = seedSelfImages(catalog, st, {}, 30 * YEAR);
    expect(seedSelfImages(catalog, st, {}, 30 * YEAR)).toEqual(a);
    const f = a["farming"];
    expect(f?.estimate.level).toBeCloseTo(
      skillLevel(farming, st["farming"]) + selfBias(farming, st["farming"], {}),
      5,
    );
    expect(SELF_IMAGES.name).toBe("skills.self_image");
  });

  it("el audaz se sobreestima y el reactivo se subestima", () => {
    const st = upbringingSkills(catalog, {}, 0, 30 * YEAR, EARTHLIKE_CLOCK)["farming"];
    const bold = selfBias(farming, st, { boldness: 2, reactivity: -1 });
    const timid = selfBias(farming, st, { boldness: -2, reactivity: 1 });
    expect(bold).toBeGreaterThan(selfBias(farming, st, {}));
    expect(timid).toBeLessThan(selfBias(farming, st, {}));
  });

  it("el principiante, que no lee sus errores, se sobreestima más que el veterano", () => {
    const novice: SkillState = {
      facets: { reading: { level: 0, peak: 0 }, execution: { level: 0.1, peak: 0.1 } },
      hours: 10,
      lastPracticed: 0,
    };
    const vet: SkillState = {
      facets: { reading: { level: 0.5, peak: 0.5 }, execution: { level: 0.5, peak: 0.5 } },
      hours: 5000,
      lastPracticed: 0,
    };
    expect(selfBias(farming, novice, {})).toBeGreaterThan(selfBias(farming, vet, {}));
  });

  it("un fracaso que no notó lo infla; uno entendido lo baja", () => {
    const verb = verbOf("farming");
    const st = upbringingSkills(catalog, {}, 0, 30 * YEAR, EARTHLIKE_CLOCK);
    const base = seedSelfImages(catalog, st, {}, 0);
    const run = (r: Partial<Attempt>) => {
      let images: SelfImages | undefined = base;
      for (let i = 0; i < 20; i++) {
        images = updateSelfImage(catalog, images, st, {}, verb, roll(r), i) ?? images;
      }
      return images["farming"]?.estimate.level ?? 0;
    };
    const unnoticed = run({ outcome: "failure_unnoticed", margin: -1, believed: "success" });
    const understood = run({
      outcome: "failure",
      margin: -1,
      believed: "failure",
      cues: ["skill"],
    });
    expect(unnoticed).toBeGreaterThan(understood);
    expect(unnoticed).toBeGreaterThan(base["farming"]?.estimate.level ?? 0);
    expect(understood).toBeLessThan(base["farming"]?.estimate.level ?? 1);
  });

  it("lo que no se tiró o no usa habilidad no cambia nada", () => {
    expect(
      updateSelfImage(
        catalog,
        undefined,
        undefined,
        {},
        verbOf("farming"),
        roll({ expected: null }),
        0,
      ),
    ).toBeNull();
    expect(updateSelfImage(catalog, undefined, undefined, {}, "wait", roll({}), 0)).toBeNull();
  });

  it("la estimación queda en 0-1 y la dispersión baja con la experiencia", () => {
    const verb = verbOf("farming");
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            believed: fc.constantFrom("success", "partial", "failure", "unsure"),
            expected: fc.double({ min: -4, max: 4, noNaN: true }),
          }),
          { minLength: 1, maxLength: 40 },
        ),
        fc.double({ min: -3, max: 3, noNaN: true }),
        (steps, t) => {
          let images: SelfImages | undefined;
          let last = Number.POSITIVE_INFINITY;
          for (const [i, s] of steps.entries()) {
            images =
              updateSelfImage(
                catalog,
                images,
                undefined,
                { boldness: t, reactivity: -t },
                verb,
                roll({ believed: s.believed, expected: s.expected }),
                i,
              ) ?? images;
            const e = images?.["farming"]?.estimate;
            expect(e?.level).toBeGreaterThanOrEqual(0);
            expect(e?.level).toBeLessThanOrEqual(1);
            expect(e?.spread ?? 0).toBeLessThanOrEqual(last);
            last = e?.spread ?? last;
          }
        },
      ),
    );
  });

  it("las palabras del panel suben con el nivel", () => {
    expect(skillStandingOf(0)).toBe("hardly");
    expect(skillStandingOf(0.3)).toBe("competent");
    expect(skillStandingOf(0.9)).toBe("master");
  });
});
