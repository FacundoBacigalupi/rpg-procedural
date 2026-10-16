import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, loadContent, Rng } from "../../core/index.ts";
import {
  type CommunityCulture,
  CULTURE_TRAITS,
  COMMUNITY_CULTURE,
  CULTURES,
  PERSON_CULTURE,
  WorldTruth,
  cultureProblems,
  diagnose,
  type PathogenDef,
  remedyEffect,
  villageCulture,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";
import type { HealerSchool } from "./medicine.ts";
import {
  MEDICINE_SCHOOL_TRAIT,
  medicalSchools,
  schoolOfCulture,
  schoolOfPerson,
} from "./medschools.ts";

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}
const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
const MEDICAL_SCHOOLS = medicalSchools(content);

const culture = (variants: Record<string, number>): CommunityCulture =>
  ({
    culture: "c",
    name: "c",
    originEventId: "event:1",
    prevalence: { [MEDICINE_SCHOOL_TRAIT]: { variants, params: {} } },
  }) as unknown as CommunityCulture;

const flu: PathogenDef = {
  id: "flu",
  routes: { air: 1, contact: 1 },
  incubationHours: 24,
  courseHours: 48,
  contagiousFrom: 0.5,
  transmissibility: 50,
  lethality: 0,
  immunity: "lifelong",
  immunityHours: 0,
};

describe("escuelas médicas por cultura", () => {
  it("la variante dominante elige la escuela; sin rasgo o sin escuela, ninguna", () => {
    expect(schoolOfCulture(culture({ humoral: 6, herbal: 2 }), MEDICAL_SCHOOLS)).toBe(
      MEDICAL_SCHOOLS["humoral"],
    );
    expect(schoolOfCulture(culture({ empirical: 1 }), MEDICAL_SCHOOLS)).toBe(
      MEDICAL_SCHOOLS["empirical"],
    );
    expect(schoolOfCulture(culture({ astral: 1 }), MEDICAL_SCHOOLS)).toBeUndefined();
    expect(schoolOfCulture(undefined, MEDICAL_SCHOOLS)).toBeUndefined();
  });

  it("la humoral yerra y sangra sin efecto real; la empírica cura", () => {
    const given = (id: string, remedies: HealerSchool | undefined) => {
      const r = remedies?.remedies.find((x) => x.id === id);
      if (!r) throw new Error(id);
      return remedyEffect(flu, {
        remedy: r,
        dose: 1,
        hoursSinceDose: r.peakHours,
        courseHoursAtDose: 0,
        skill: 1,
      });
    };
    expect(given("bloodletting", MEDICAL_SCHOOLS["humoral"])).toBe(0);
    expect(given("infusion", MEDICAL_SCHOOLS["empirical"])).toBeGreaterThan(0.3);
    const signs = { fever: 0.8, weakness: 0.6 };
    const h = diagnose(signs, MEDICAL_SCHOOLS["humoral"]?.models ?? [], 1, 1, Rng.root(1));
    const e = diagnose(signs, MEDICAL_SCHOOLS["empirical"]?.models ?? [], 1, 1, Rng.root(1));
    expect(h?.condition).toBe("hot_blood");
    expect(e?.condition).toBe("flu");
  });

  it("toda variante del rasgo tiene escuela y las remediaciones existen", () => {
    const trait = content.all(CULTURE_TRAITS).find((t) => t.id === MEDICINE_SCHOOL_TRAIT);
    for (const v of trait?.variants ?? []) {
      const s = MEDICAL_SCHOOLS[v.id];
      expect(s, v.id).toBeDefined();
      for (const rid of Object.values(s?.remedyFor ?? {})) {
        expect(s?.remedies.some((r) => r.id === rid)).toBe(true);
      }
    }
    const village = content.all(CULTURES).find((c) => c.id === "village.medicine");
    if (!village) throw new Error("falta village.medicine");
    expect(cultureProblems(village, content.all(CULTURE_TRAITS))).toEqual([]);
  });

  it("opt-in: apagado la aldea no tiene el rasgo; prendido sale la escuela, determinista", () => {
    const off = Life.create(7, content).world;
    expect(villageCulture(off.truth)?.prevalence[MEDICINE_SCHOOL_TRAIT]).toBeUndefined();
    const on = Life.create(7, content, { medicalSchools: true }).world;
    expect(villageCulture(on.truth)?.prevalence[MEDICINE_SCHOOL_TRAIT]).toBeDefined();
    expect(schoolOfCulture(villageCulture(on.truth), MEDICAL_SCHOOLS)).toBe(
      MEDICAL_SCHOOLS["herbal"],
    );
    const again = Life.create(7, content, { medicalSchools: true }).world;
    expect(villageCulture(again.truth)).toEqual(villageCulture(on.truth));
  }, 30_000);
});

describe("escuela médica por comunidad", () => {
  const community = (id: string, variants: Record<string, number>) =>
    ({ ...culture(variants), culture: id }) as CommunityCulture;
  const who = "agent:1" as AgentId;
  const world = (communities: CommunityCulture[], group?: string) => {
    const t = new WorldTruth();
    for (const c of communities) t.set(COMMUNITY_CULTURE, `settlement:${c.culture === "a" ? 1 : 2}` as never, c);
    if (group)
      t.set(
        PERSON_CULTURE,
        who as never,
        {
          holdings: {},
          identity: [{ about: who, group, confidence: 0.9, basis: [] }],
          originEventId: "event:1",
        } as never,
      );
    return t;
  };

  it("con una sola comunidad es su escuela; sin comunidades, ninguna", () => {
    const one = world([community("a", { humoral: 3 })]);
    expect(schoolOfPerson(one, who, MEDICAL_SCHOOLS)).toBe(MEDICAL_SCHOOLS["humoral"]);
    expect(schoolOfPerson(new WorldTruth(), who, MEDICAL_SCHOOLS)).toBeUndefined();
  });

  it("con varias, cada persona sigue la de su grupo; sin grupo, la primera por id", () => {
    const cs = [community("a", { humoral: 3 }), community("b", { empirical: 3 })];
    expect(schoolOfPerson(world(cs, "b"), who, MEDICAL_SCHOOLS)).toBe(MEDICAL_SCHOOLS["empirical"]);
    expect(schoolOfPerson(world(cs, "a"), who, MEDICAL_SCHOOLS)).toBe(MEDICAL_SCHOOLS["humoral"]);
    expect(schoolOfPerson(world(cs), who, MEDICAL_SCHOOLS)).toBe(MEDICAL_SCHOOLS["humoral"]);
    expect(schoolOfPerson(world(cs, "b"), who, MEDICAL_SCHOOLS)).toBe(
      schoolOfPerson(world([...cs].reverse(), "b"), who, MEDICAL_SCHOOLS),
    );
  });
});
