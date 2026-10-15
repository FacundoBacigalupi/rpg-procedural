import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, loadContent } from "../../core/index.ts";
import {
  ACTIONS,
  ActionCatalog,
  BELIEFS,
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
import { planFromDecision, planFromTemplate, templateKeyFor, templateParams } from "./npc-verbs.ts";
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

describe("más plantillas de NPC y parámetros de persona (npc-d2)", () => {
  const more = [
    ...places,
    { id: "place:river", kind: "water", hexes: [4] },
    { id: "place:wood", kind: "forest", hexes: [3] },
  ];
  const friend = "agent:9";
  const people = {
    target: friend,
    believedHex: (who: string) => (who === friend ? 2 : undefined),
  };

  it("las plantillas nuevas están en content/plans/ y validan", () => {
    expect(catalog.template("fetchwater")?.params.map((p) => p.id)).toEqual(["water", "home"]);
    expect(catalog.template("gatherwood")?.params.map((p) => p.id)).toEqual(["wood", "home"]);
    expect(catalog.template("marketround")?.params.map((p) => p.id)).toEqual([
      "market",
      "seller",
      "home",
    ]);
    expect(catalog.template("visit")?.params.map((p) => p.id)).toEqual([
      "friend",
      "friend_at",
      "home",
    ]);
  });

  it("agua y monte: el lugar más cercano de su clase, como fieldwork", () => {
    const water = catalog.template("fetchwater");
    const wood = catalog.template("gatherwood");
    if (!water || !wood) throw new Error("faltan plantillas");
    expect(templateParams(water, more, line, 1)).toEqual({
      water: "place:river",
      home: "place:village",
    });
    expect(templateParams(wood, more, line, 5)).toEqual({
      wood: "place:wood",
      home: "place:village",
    });
    expect(templateParams(water, places, line, 1)).toBeUndefined();
    const plan = planFromTemplate(
      water,
      { water: "place:river", home: "place:village" } as never,
      me,
    );
    expect(plan?.root).toMatchObject({
      kind: "seq",
      steps: [
        { verb: "move", args: [{ role: "to", entity: "place:river" }] },
        { verb: "drink", args: [] },
        { verb: "move", args: [{ role: "to", entity: "place:village" }] },
      ],
    });
  });

  it("la persona es el objetivo de la decisión y su lugar, donde el actor la cree", () => {
    const visit = catalog.template("visit");
    if (!visit) throw new Error("falta visit");
    expect(templateParams(visit, places, line, 0, people)).toEqual({
      friend,
      friend_at: "place:near",
      home: "place:village",
    });
    // Sin persona de objetivo, con un lugar de objetivo o sin creencia de dónde está: sin resolver.
    expect(templateParams(visit, places, line, 0)).toBeUndefined();
    expect(templateParams(visit, places, line, 0, { ...people, target: "place:far" })).toBe(
      undefined,
    );
    expect(
      templateParams(visit, places, line, 0, { target: friend, believedHex: () => undefined }),
    ).toBeUndefined();
    // Lo creído manda aunque esté errado: lo cree en el hex 5, va al campo lejano.
    expect(
      templateParams(visit, places, line, 0, { target: friend, believedHex: () => 5 })?.[
        "friend_at"
      ],
    ).toBe("place:far");
    // Lo cree en un hex sin lugar conocido: sin resolver.
    expect(
      templateParams(visit, places, line, 0, { target: friend, believedHex: () => 3 }),
    ).toBeUndefined();
  });

  it("verbo@clase antes que el verbo", () => {
    const by = { move: "a", "move@water": "fetchwater", "speak@person": "visit" };
    expect(templateKeyFor(by, "move", "water")).toBe("fetchwater");
    expect(templateKeyFor(by, "move", "forest")).toBe("a");
    expect(templateKeyFor(by, "move", undefined)).toBe("a");
    expect(templateKeyFor(by, "speak", "person")).toBe("visit");
    expect(templateKeyFor(by, "speak", undefined)).toBeUndefined();
  });

  it("el paso del verbo decidido lleva los argumentos de la decisión (qué comerciar, qué decir)", () => {
    const round = catalog.template("marketround");
    const visit = catalog.template("visit");
    if (!round || !visit) throw new Error("faltan plantillas");
    const params = templateParams(round, places, line, 3, people);
    expect(params).toEqual({ market: "place:village", seller: friend, home: "place:village" });
    const decided = planFromDecision({ id: `trade:${friend}+grain`, verb: "trade" }, catalog, me);
    const plan = planFromTemplate(round, params, me, decided);
    expect(plan?.goal).toBe("marketround");
    expect(plan?.root).toMatchObject({
      steps: [
        { verb: "move", args: [{ role: "to", entity: "place:village" }] },
        { verb: "look" },
        {
          verb: "trade",
          args: [
            { role: "with", entity: friend },
            { role: "what", text: "grain" },
          ],
        },
        { verb: "move", args: [{ role: "to", entity: "place:village" }] },
      ],
    });
    const said = planFromDecision(
      { id: `speak:${friend}`, verb: "speak", act: { kind: "greet" } as never },
      catalog,
      me,
    );
    const v = planFromTemplate(visit, templateParams(visit, places, line, 0, people), me, said);
    const speakStep = v?.root.kind === "seq" ? v.root.steps[1] : undefined;
    expect(speakStep).toMatchObject({
      verb: "speak",
      args: [
        { role: "to", entity: friend },
        { role: "content", act: { kind: "greet" } },
      ],
    });
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

  it("move@water -> fetchwater y speak@person -> visit: van, hacen y vuelven, sin viaje", () => {
    const life = Life.create(7, content, {
      npcVerbs: ["move", "speak"],
      npcTemplates: { "move@water": "fetchwater", "speak@person": "visit" },
    });
    const w = life.world;
    const adults = living(w.truth).filter(
      (x) =>
        x !== life.player && (w.truth.get(PERSON, x)?.born ?? 0) < life.now - 20 * 365 * 86_400,
    ) as AgentId[];
    const [walker, visitor, friend] = adults;
    if (!walker || !visitor || !friend) throw new Error("faltan adultos");
    const water = w.truth.ids(PLACE).find((id) => w.truth.get(PLACE, id)?.kind === "water");
    if (!water) throw new Error("sin agua en la aldea del seed 7");
    w.truth.set(NPC_DECISION, walker, {
      at: life.now,
      id: `move:${water}`,
      verb: "move",
      target: water,
      utility: 1,
      options: 2,
    } as never);
    // El visitante cree que su conocido está donde está de verdad (una creencia `at` vista).
    const at = w.truth.get(LOCATION, friend);
    if (!at) throw new Error("sin lugar");
    const prev = w.truth.get(BELIEFS, visitor)?.items ?? [];
    w.truth.set(BELIEFS, visitor, {
      items: [
        ...prev.filter((b) => !(b.prop.subject === friend && b.prop.attr === "at")),
        {
          prop: { kind: "attr", subject: friend, attr: "at" },
          value: { hex: at.hex },
          confidence: 1,
          asOf: life.now,
          learnedAt: life.now,
          sources: [{ kind: "percept", percept: "sight", tick: life.now }],
          salience: 1,
          measured: life.now,
        },
      ],
    } as never);
    w.truth.set(NPC_DECISION, visitor, {
      at: life.now,
      id: `speak:${friend}`,
      verb: "speak",
      target: friend,
      utility: 1,
      options: 2,
    } as never);
    life.advanceTo(life.now + 86_400);
    const kinds = (who: AgentId) =>
      w.log
        .all()
        .filter((e) => e.actors[0] === who && e.kind.startsWith("action."))
        .map((e) => e.kind);
    const walked = kinds(walker);
    const drank = walked.indexOf("action.drink");
    expect(drank).toBeGreaterThan(-1);
    expect(walked.slice(0, drank)).toContain("action.move");
    expect(walked.slice(drank + 1)).toContain("action.move");
    expect(w.truth.get(PLAN_STATE, walker)?.plan.goal).toBe("fetchwater");
    const visited = kinds(visitor);
    expect(visited).toContain("action.speak");
    expect(visited.slice(visited.indexOf("action.speak") + 1)).toContain("action.wait");
    expect(w.truth.get(PLAN_STATE, visitor)?.plan.goal).toBe("visit");
  }, 240_000);
});
