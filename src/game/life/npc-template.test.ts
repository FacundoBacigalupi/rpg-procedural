import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, loadContent } from "../../core/index.ts";
import {
  ACTIONS,
  ActionCatalog,
  LOCATION,
  type LocalMap,
  PERSON,
  PLACE,
  PLANS,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { PLAN_STATE } from "./act.ts";
import { NPC_DECISION } from "./decide.ts";
import { Life } from "./life.ts";
import { planFromTemplate, templateParams } from "./npc-verbs.ts";
import { living } from "./world.ts";

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
const catalog = new ActionCatalog(content.all(ACTIONS), content.all(PLANS));
const fieldwork = catalog.template("fieldwork");

// Una línea de seis hexes: 0-1-2-3-4-5.
const line = {
  neighbors: [[1], [0, 2], [1, 3], [2, 4], [3, 5], [4]],
  crossSeconds: [100, 100, 100, 100, 100, 100],
} as unknown as LocalMap;
const places = [
  { id: "place:village", kind: "village", hexes: [0] },
  { id: "place:far", kind: "fields", hexes: [5] },
  { id: "place:near", kind: "fields", hexes: [2] },
];
const me = "agent:1" as AgentId;

describe("plantillas de plan para el NPC", () => {
  it("fieldwork está en content/plans/ y valida (campo, trabajo, vuelta)", () => {
    expect(fieldwork?.params.map((p) => p.id)).toEqual(["field", "home"]);
  });

  it("los parámetros salen del lugar más cercano de cada clase", () => {
    if (!fieldwork) throw new Error("falta fieldwork");
    expect(templateParams(fieldwork, places, line, 1)).toEqual({
      field: "place:near",
      home: "place:village",
    });
    expect(templateParams(fieldwork, places, line, 4)).toEqual({
      field: "place:far",
      home: "place:village",
    });
    // Sin lugar de una clase, sin posición o con un parámetro desconocido: sin resolver.
    expect(templateParams(fieldwork, [places[0] as never], line, 1)).toBeUndefined();
    expect(templateParams(fieldwork, places, line, undefined)).toBeUndefined();
  });

  it("el plan expande los pasos en orden con fuente utility", () => {
    if (!fieldwork) throw new Error("falta fieldwork");
    const plan = planFromTemplate(
      fieldwork,
      { field: "place:near" as never, home: "place:village" as never },
      me,
    );
    expect(plan?.source).toBe("utility");
    expect(plan?.root).toMatchObject({
      kind: "seq",
      steps: [
        { verb: "move", args: [{ role: "to", entity: "place:near" }] },
        { verb: "work", args: [{ role: "for", seconds: 14400 }] },
        { verb: "move", args: [{ role: "to", entity: "place:village" }] },
      ],
    });
    expect(planFromTemplate(fieldwork, undefined, me)).toBeUndefined();
  });
});

describe("el NPC ejecuta un plan de varios pasos (opt-in)", () => {
  it("work -> fieldwork: va al campo, trabaja y vuelve, en ese orden", () => {
    const life = Life.create(7, content, {
      npcVerbs: ["work"],
      npcTemplates: { work: "fieldwork" },
    });
    const w = life.world;
    const npc = living(w.truth).find(
      (x) =>
        x !== life.player && (w.truth.get(PERSON, x)?.born ?? 0) < life.now - 20 * 365 * 86_400,
    ) as AgentId;
    const fieldHexes = w.truth
      .ids(PLACE)
      .flatMap((id) =>
        w.truth.get(PLACE, id)?.kind === "fields" ? (w.truth.get(PLACE, id)?.hexes ?? []) : [],
      );
    w.truth.set(NPC_DECISION, npc, {
      at: life.now,
      id: "work:",
      verb: "work",
      utility: 1,
      options: 2,
    } as never);
    life.advanceTo(life.now + 2 * 86_400);
    const mine = w.log
      .all()
      .filter((e) => e.actors[0] === npc && (e.kind === "action.move" || e.kind === "action.work"))
      .map((e) => e.kind);
    const first = mine.indexOf("action.work");
    expect(first).toBeGreaterThan(-1);
    expect(mine.slice(0, first)).toContain("action.move");
    expect(mine.slice(first + 1)).toContain("action.move");
    expect(w.truth.get(PLAN_STATE, npc)?.plan.goal).toBe("fieldwork");
    expect(fieldHexes.length).toBeGreaterThan(0);
    expect(w.truth.get(LOCATION, npc)).toBeDefined();
  }, 240_000);
});
