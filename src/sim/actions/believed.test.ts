import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type EntityRef, loadContent, makeId } from "../../core/index.ts";
import { TRAITS } from "../family/index.ts";
import { displayedLevel, observedLevel, SKILLS, seesThrough } from "../skills/index.ts";
import {
  ACTIONS,
  ActionCatalog,
  type ActionPlan,
  assessPlan,
  type BeliefView,
  baseMargin,
  believedChance,
  chanceAt,
  chanceError,
  PLANS,
  type PlanNode,
  type Scene,
} from "./index.ts";

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
const wu = makeId("agent", 2);

const strike = catalog.verb("strike");
if (!strike) throw new Error("falta strike");
const node: Extract<PlanNode, { kind: "do" }> = {
  kind: "do",
  verb: "strike",
  args: [{ role: "target", entity: wu }],
  manner: [],
};
const day: Scene = { light: 1, terrain: 0.1, placeKinds: [] };
const dark: Scene = { light: 0, terrain: 0.1, placeKinds: [] };
const input = (scene: Scene, boldness = 0) => ({
  def: strike,
  node,
  planManner: [],
  actor: { id: me as EntityRef, z: { boldness }, capabilities: {}, hex: 0 },
  scene,
});

describe("chance creída con la autoimagen", () => {
  it("baseMargin con la habilidad verdadera es lo que usa la tirada", () => {
    const a = baseMargin(input(day), 0.5);
    const b = baseMargin(input(day), 0.5);
    expect(a).toEqual(b);
    expect(baseMargin(input(day), 0.9).expected).toBeGreaterThan(a.expected);
  });

  it("sube con el nivel que cree tener y se abre con la duda", () => {
    expect(chanceAt(input(day), 0.9)).toBeGreaterThan(chanceAt(input(day), 0.1));
    const sure = believedChance(input(day), { level: 0.4, spread: 0 });
    const unsure = believedChance(input(day), { level: 0.4, spread: 0.3 });
    expect(unsure.high - unsure.low).toBeGreaterThan(sure.high - sure.low);
    expect(unsure.chance).toBe(sure.chance);
  });

  it("el que se sobreestima se cree con más chance que la verdadera", () => {
    expect(chanceError(input(day), { level: 0.7, spread: 0.1 }, 0.2)).toBeGreaterThan(0);
    expect(chanceError(input(day), { level: 0.2, spread: 0.1 }, 0.7)).toBeLessThan(0);
  });

  it("aviso de riesgo: sale con la autoimagen baja y no con la verdad", () => {
    const view = (level: number): BeliefView => ({
      hex: 0,
      capability: () => 1,
      skill: () => ({ level, spread: 0.1 }),
      hexOf: () => 0,
      hexesOf: () => undefined,
      placeKindsAt: () => [],
      holds: () => undefined,
      nameOf: () => "Wu",
      risk: { id: me, z: { boldness: -2 }, scene: dark },
    });
    const plan: ActionPlan = { actor: me, source: "player", root: node, manner: [], causes: [] };
    // Cree saber poco: avisa que no le va a salir. Aunque la verdad fuera otra, no la mira.
    const timid = assessPlan(plan, catalog, view(0.12));
    expect(timid.map((w) => w.kind)).toContain("risky");
    expect(timid.find((w) => w.kind === "risky")?.blocks).toBe(false);
    // Se cree bueno: no avisa.
    expect(assessPlan(plan, catalog, view(0.9)).map((w) => w.kind)).not.toContain("risky");
  });
});

describe("esconder y aparentar habilidad", () => {
  it("esconder baja lo mostrado, aparentar lo sube, y el control alcanza más", () => {
    const hide = displayedLevel(0.6, "hide", 1, 0.9);
    expect(hide.shown).toBeLessThan(0.6);
    expect(displayedLevel(0.6, "show", 1, 0.9).shown).toBeGreaterThan(0.6);
    expect(displayedLevel(0.6, "hide", 1, 0.1).gap).toBeGreaterThan(hide.gap);
    expect(displayedLevel(0.6, "natural", 1, 0.9).gap).toBe(0);
  });

  it("el que mira bien la pincha y el distraído se la cree", () => {
    const d = displayedLevel(0.8, "hide", 1, 0.2);
    expect(seesThrough(d, 0.9, 0.2, 0)).toBe(true);
    expect(seesThrough(d, 0, 0.9, 0)).toBe(false);
    expect(observedLevel(0.8, d, false)).toEqual({ level: d.shown, fooled: true });
    expect(observedLevel(0.8, d, true)).toEqual({ level: 0.8, fooled: false });
  });
});
