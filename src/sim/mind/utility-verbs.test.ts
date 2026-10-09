import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type EntityRef, loadContent, makeId } from "../../core/index.ts";
import { ACTIONS, ActionCatalog, type BeliefView, PLANS } from "../actions/index.ts";
import { TRAITS } from "../family/index.ts";
import { SKILLS } from "../skills/index.ts";
import { rank } from "./utility.ts";
import { SOCIAL_VERBS, socialCandidates } from "./utility-social.ts";
import { mergeCandidates, pantryTexts, verbCandidates } from "./utility-verbs.ts";

const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const content = loadContent(
  [ACTIONS, PLANS, SKILLS, TRAITS],
  [
    { kind: "actions", file: "content/actions/core.json", data: json("content/actions/core.json") },
    { kind: "skills", file: "content/skills/core.json", data: json("content/skills/core.json") },
    { kind: "traits", file: "content/traits/human.json", data: json("content/traits/human.json") },
    { kind: "plans", file: "content/plans/steal.json", data: json("content/plans/steal.json") },
  ],
);
const catalog = new ActionCatalog(content.all(ACTIONS), content.all(PLANS));
const me = makeId("agent", 1);
const wu = makeId("agent", 2) as unknown as EntityRef;

const view = (over: Partial<BeliefView> = {}): BeliefView => ({
  hex: 5,
  capability: () => 1,
  skill: () => ({ level: 0.6, spread: 0.1 }),
  hexOf: (ref) => (ref === wu ? 9 : undefined),
  hexesOf: () => undefined,
  placeKindsAt: () => ["village"],
  holds: () => true,
  nameOf: () => "Wu",
  risk: { id: me as unknown as EntityRef, z: {}, scene: { light: 1, terrain: 0, placeKinds: [] } },
  ...over,
});

describe("verbCandidates", () => {
  it("arma candidatas de los verbos con impulsos, con el objetivo creído", () => {
    const cs = verbCandidates({ catalog, view: view(), persons: [wu], places: [] });
    const ids = cs.map((c) => c.id);
    expect(ids).toContain("eat:");
    expect(ids).toContain(`search:${wu}`);
    expect(ids).toContain(`strike:${wu}`);
  });

  it("no incluye lo que cree imposible", () => {
    const body = view({ capability: (c) => (c === "manipulation" ? 0.05 : 1) });
    const cs = verbCandidates({ catalog, view: body, persons: [wu], places: [] });
    expect(cs.map((c) => c.verb)).not.toContain("eat");
  });

  it("duda de dónde está el otro y baja la chance de buscarlo", () => {
    const known = verbCandidates({ catalog, view: view(), persons: [wu], places: [] });
    const lost = verbCandidates({
      catalog,
      view: view({ hexOf: () => null }),
      persons: [wu],
      places: [],
    });
    const pick = (cs: typeof known) => cs.find((c) => c.verb === "search")?.chance ?? 0;
    expect(pick(lost)).toBeLessThan(pick(known));
  });

  it("con hambre apremiante elige comer", () => {
    const cs = verbCandidates({ catalog, view: view(), persons: [wu], places: [] });
    const [best] = rank(cs, { needs: { hunger: 1 }, values: {} }, { boldness: 0.5 });
    expect(best?.candidate.verb).toBe("eat");
  });
});

describe("verbos sociales y textos", () => {
  it("los verbos sociales existen en el catálogo", () => {
    const ids = new Set(catalog.verbs.map((v) => v.id));
    for (const v of Object.values(SOCIAL_VERBS)) expect(ids.has(v)).toBe(true);
  });

  it("los verbos con what prueban lo que hay en la despensa", () => {
    const texts = pantryTexts([
      { name: "pan", amount: 500 },
      { name: "sal", amount: 0 },
    ]);
    const cs = verbCandidates({ catalog, view: view(), persons: [wu], places: [], texts });
    const ids = cs.map((c) => c.id);
    expect(ids).toContain("cook:pan");
    expect(ids).toContain("eat:pan");
    expect(ids.some((i) => i.endsWith("sal"))).toBe(false);
    expect(ids).toContain(`give:${wu}+pan`);
  });

  it("la candidata social reemplaza a la del catálogo con el mismo verbo y objetivo", () => {
    const base = verbCandidates({ catalog, view: view(), persons: [wu], places: [] });
    const social = socialCandidates({
      target: wu as unknown as string,
      dims: {
        affection: 0.5,
        gratitude: 0,
        fear: 0,
        resentment: 0,
        jealousy: 0,
        familiarity: 0.5,
      } as never,
      bonds: [],
      belief: { need: 0.6, threat: 0, confidence: 0.8 },
      means: { surplus: 0.8 },
    });
    const merged = mergeCandidates(base, social);
    expect(merged.filter((c) => c.id === `give:${wu}`)).toHaveLength(1);
    expect(merged.find((c) => c.id === `give:${wu}`)?.contributes.family).toBe(
      social[1]?.contributes.family,
    );
  });
});
