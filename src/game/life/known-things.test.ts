import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type ContentSource,
  type EntityRef,
  type EventId,
  type ItemId,
  loadContent,
  makeId,
} from "../../core/index.ts";
import {
  CARRIED,
  type DraftResult,
  ENTITY,
  type IntentDraft,
  ITEM_HOLD,
  ITEM_LOOK,
  type ItemLook,
  LOCATION,
  planFromDraft,
  VILLAGE_SQUARE,
  WORK,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { fixturesInSight } from "./fixtures.ts";
import { knownEntities } from "./known.ts";
import { Life } from "./life.ts";
import { itemsSeen, playerView } from "./view.ts";
import type { LifeWorld } from "./world.ts";

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

/** Deja una cosa suelta al lado del personaje (o en manos de alguien con `holder`). */
function drop(w: LifeWorld, n: number, look: ItemLook, holder?: EntityRef): ItemId {
  const id = makeId("item", 900 + n);
  const here = w.truth.get(LOCATION, w.player);
  if (!here) throw new Error("sin lugar");
  w.truth.set(ENTITY, id, { id, createdAt: 0, originEventId: "event:1" as EventId });
  w.truth.set(ITEM_LOOK, id, look);
  if (holder === undefined) w.truth.set(LOCATION, id, here);
  else w.truth.set(ITEM_HOLD, id, { possession: holder as never, rights: [] });
  return id;
}

function take(w: LifeWorld, text: string, things = itemsSeen(w)): DraftResult {
  return draft(w, "take", { role: "what", ref: { text, features: [] } }, things);
}

function draft(w: LifeWorld, verb: string, arg: unknown, things = itemsSeen(w)): DraftResult {
  return planFromDraft({ kind: "act", plan: { kind: "do", verb, args: [arg] } } as IntentDraft, {
    actor: w.player,
    source: "player",
    catalog: w.catalog,
    known: knownEntities(w, [], things),
    clock: w.clock,
    causes: [{ kind: "state", entity: w.player, key: "intent" }],
    here: w.truth.get(LOCATION, w.player)?.hex,
  });
}

/** El `what` del primer paso de un plan, entidad o texto. */
function whatOf(r: DraftResult): string | undefined {
  if (r.kind !== "plan" || r.plan.root.kind !== "do") return undefined;
  const a = r.plan.root.args.find((x) => x.role === "what");
  return a === undefined ? undefined : "entity" in a ? a.entity : "text" in a ? a.text : undefined;
}

describe("cosas sueltas con identidad (play-refs-objects-loose)", () => {
  it("se ven con su forma, material y tamaño y se nombran al escribir", () => {
    const life = Life.create(7, content, { frequency: 8 });
    const w = life.world;
    expect(itemsSeen(w)).toEqual([]);
    const knife = drop(w, 1, { shape: "knife", material: "iron", size: "small" });
    const basket = drop(w, 2, { shape: "basket", material: "bamboo", size: "medium" });
    // En manos de alguien no es una cosa suelta: no se lista.
    const sword = drop(w, 3, { shape: "sword", material: "iron", size: "medium" }, w.player);
    const seen = itemsSeen(w);
    expect(seen.map((p) => p.sourceEntityId).sort()).toEqual([knife, basket].sort());
    expect(seen.every((p) => p.fields.thing !== undefined)).toBe(true);
    // Determinista: la misma escena da los mismos percepts.
    expect(itemsSeen(w)).toEqual(seen);
    const objects = knownEntities(w, [], seen).filter((k) => k.kind === "object");
    // Lo que lleva lo conoce como suyo (play-refs-objects-source-drop), no como cosa suelta.
    const carried = objects.filter((k) => k.relations.some((r) => r.rel === CARRIED));
    expect(carried.map((k) => k.ref)).toEqual([sword]);
    const things = objects.filter((k) => !carried.includes(k));
    expect(things.map((k) => k.ref).sort()).toEqual([knife, basket].sort());
    const k = things.find((t) => t.ref === knife);
    expect(k?.names).toContain("cuchillo");
    expect(k?.features).toEqual(expect.arrayContaining(["de hierro", "chico", "suelo"]));
    expect(k?.present).toBe(true);

    expect(whatOf(take(w, "el cuchillo del suelo"))).toBe(knife);
    expect(whatOf(take(w, "la canasta de bambú"))).toBe(basket);
    expect(whatOf(take(w, "la cesta"))).toBe(basket);
    // Lo que no es una cosa vista sigue siendo un bien por nombre.
    expect(whatOf(take(w, "el pan"))).toBe("el pan");
    // Sin verla (no está en la escena) tampoco se la nombra como cosa.
    expect(whatOf(take(w, "el cuchillo", []))).toBe("el cuchillo");
  });

  it("dos cosas que encajan se preguntan; las personas de la escena no cambian", () => {
    const life = Life.create(7, content, { frequency: 8 });
    const w = life.world;
    let before: unknown;
    playerView(w, [], { intro: true, onSeen: (p) => (before = p) });
    drop(w, 1, { shape: "knife", material: "iron", size: "small" });
    const bronze = drop(w, 2, { shape: "knife", material: "bronze", size: "small" });
    let after: unknown;
    playerView(w, [], { intro: true, onSeen: (p) => (after = p) });
    expect(after).toEqual(before);
    expect(take(w, "el cuchillo").kind).toBe("clarify");
    expect(whatOf(take(w, "el cuchillo de bronce"))).toBe(bronze);
  });
});

describe("mirar una cosa (play-refs-objects-look)", () => {
  it("«miro la canasta» la mira a ella y la vista la marca con sus rasgos", () => {
    const life = Life.create(7, content, { frequency: 8 });
    const w = life.world;
    const knife = drop(w, 1, { shape: "knife", material: "iron", size: "small" });
    const basket = drop(w, 2, { shape: "basket", material: "bamboo", size: "medium" });
    // El parser la adivinó como persona: el verbo acepta cosas y personas, se busca entre todas.
    const made = draft(w, "look", {
      role: "target",
      ref: { text: "la canasta", kind: "person", features: [] },
    });
    expect(made.kind).toBe("plan");
    if (made.kind !== "plan") return;
    expect(made.plan.root).toMatchObject({
      kind: "do",
      verb: "look",
      args: [{ role: "target", entity: basket }],
    });
    const report = life.turn(made.plan, 1);
    const looked = report.steps.findLast((s) => s.verb === "look");
    expect(looked?.self.effect).toMatchObject({ kind: "observe", target: basket });
    const view = playerView(w, report.steps, { heardSince: report.from });
    const things = view.things ?? [];
    expect(things).toEqual(
      expect.arrayContaining([
        { shape: "basket", material: "bamboo", size: "medium", looked: true },
        { shape: "knife", material: "iron", size: "small" },
      ]),
    );
    expect(things.filter((t) => t.looked === true)).toHaveLength(1);
    expect(knife).not.toBe(basket);
  });

  it("sin argumento sigue siendo mirar alrededor; sin cosas la vista no cambia", () => {
    const life = Life.create(7, content, { frequency: 8 });
    const w = life.world;
    const made = planFromDraft(
      { kind: "act", plan: { kind: "do", verb: "look", args: [] } } as never,
      {
        actor: w.player,
        source: "player",
        catalog: w.catalog,
        known: knownEntities(w),
        clock: w.clock,
        causes: [{ kind: "state", entity: w.player, key: "intent" }],
      },
    );
    expect(made.kind).toBe("plan");
    if (made.kind !== "plan") return;
    const report = life.turn(made.plan, 1);
    const looked = report.steps.findLast((s) => s.verb === "look");
    expect(looked?.self.effect.kind).toBe("observe");
    expect(looked?.self.effect).not.toHaveProperty("target");
    expect(playerView(w, report.steps, { heardSince: report.from }).things).toBeUndefined();
  });
});

describe("mirar lo fijo (play-refs-objects-fixtures-look)", () => {
  /** Lleva al personaje a la plaza, donde está el pozo. */
  function toSquare(w: LifeWorld): EntityRef {
    const well = [...w.truth.ids(WORK)].find((id) => w.truth.get(WORK, id)?.kind === "well");
    const hex = well === undefined ? undefined : w.truth.get(WORK, well)?.hexes[0];
    if (well === undefined || hex === undefined) throw new Error("sin pozo");
    w.truth.set(LOCATION, w.player, { hex, space: VILLAGE_SQUARE });
    return well as EntityRef;
  }

  it("en la plaza «miro el pozo» lo mira a él y la vista lo trae con su estado", () => {
    const life = Life.create(7, content, { frequency: 8 });
    const w = life.world;
    const well = toSquare(w);
    const fixtures = fixturesInSight(w);
    expect(fixtures.map((f) => f.ref)).toEqual([well]);
    const made = draft(w, "look", { role: "target", ref: { text: "el pozo", features: [] } });
    expect(made.kind).toBe("plan");
    if (made.kind !== "plan") return;
    expect(made.plan.root).toMatchObject({
      verb: "look",
      args: [{ role: "target", entity: well }],
    });
    const report = life.turn(made.plan, 1);
    const looked = report.steps.findLast((s) => s.verb === "look");
    expect(looked?.self.effect).toMatchObject({ kind: "observe", target: well });
    const view = playerView(w, report.steps, { heardSince: report.from });
    const state = fixtures[0]?.state;
    expect(view.things).toContainEqual({
      shape: "well",
      size: "large",
      looked: true,
      ...(state !== undefined ? { state } : {}),
    });
  });

  it("lo fijo no se agarra y sin mirarlo no entra a la vista", () => {
    const life = Life.create(7, content, { frequency: 8 });
    const w = life.world;
    const well = toSquare(w);
    expect(whatOf(take(w, "el pozo"))).not.toBe(well);
    const made = planFromDraft(
      { kind: "act", plan: { kind: "do", verb: "look", args: [] } } as never,
      {
        actor: w.player,
        source: "player",
        catalog: w.catalog,
        known: knownEntities(w),
        clock: w.clock,
        causes: [{ kind: "state", entity: w.player, key: "intent" }],
      },
    );
    if (made.kind !== "plan") throw new Error("sin plan");
    const report = life.turn(made.plan, 1);
    const shapes = (playerView(w, report.steps, { heardSince: report.from }).things ?? []).map(
      (t) => t.shape,
    );
    expect(shapes).not.toContain("well");
  });
});
