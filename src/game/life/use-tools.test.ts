import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type ContentSource,
  type EventId,
  type ItemId,
  loadContent,
  makeId,
} from "../../core/index.ts";
import {
  checkInvariants,
  type DraftResult,
  ENTITY,
  type IntentDraft,
  ITEM_HOLD,
  ITEM_LOOK,
  ITEM_WEAR,
  LOCATION,
  planFromDraft,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { knownEntities } from "./known.ts";
import { Life } from "./life.ts";
import { itemsSeen } from "./view.ts";
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

/** Un cuchillo; si `held`, lo lleva el personaje. */
function knifeOf(w: LifeWorld, held: boolean): ItemId {
  const id = makeId("item", 951);
  w.truth.set(ENTITY, id, { id, createdAt: 0, originEventId: "event:1" as EventId });
  w.truth.set(ITEM_LOOK, id, { shape: "knife", material: "iron", size: "small" });
  w.truth.set(ITEM_HOLD, id, { possession: (held ? w.player : null) as never, rights: [] });
  return id;
}

function gather(w: LifeWorld): DraftResult {
  return planFromDraft(
    {
      kind: "act",
      plan: {
        kind: "do",
        verb: "gather",
        args: [
          { role: "what", text: "hongos" },
          { role: "with", ref: { text: "cuchillo", kind: "object", features: ["cuchillo"] } },
        ],
      },
    } as IntentDraft,
    {
      actor: w.player,
      source: "player",
      catalog: w.catalog,
      known: knownEntities(w, [], itemsSeen(w)),
      clock: w.clock,
      causes: [{ kind: "state", entity: w.player, key: "intent" }],
      here: w.truth.get(LOCATION, w.player)?.hex,
    },
  );
}

function withOf(r: DraftResult): string | undefined {
  if (r.kind !== "plan" || r.plan.root.kind !== "do") throw new Error(r.kind);
  const a = r.plan.root.args.find((x) => x.role === "with");
  return a !== undefined && "entity" in a ? a.entity : undefined;
}

/** Una herramienta de la forma `shape` en manos del personaje. */
function hold(w: LifeWorld, n: number, shape: string): ItemId {
  const id = makeId("item", 960 + n);
  w.truth.set(ENTITY, id, { id, createdAt: 0, originEventId: "event:1" as EventId });
  w.truth.set(ITEM_LOOK, id, { shape, material: "iron", size: "medium" });
  w.truth.set(ITEM_HOLD, id, { possession: w.player as never, rights: [] });
  return id;
}

/** «uso X [para how]» como lo deja la gramática. */
function use(w: LifeWorld, noun: string, how?: string): DraftResult {
  return planFromDraft(
    {
      kind: "act",
      plan: {
        kind: "do",
        verb: "use",
        args: [
          { role: "target", ref: { text: `el ${noun}`, kind: "object", features: [noun] } },
          ...(how !== undefined ? [{ role: "how", text: how }] : []),
        ],
      },
    } as IntentDraft,
    {
      actor: w.player,
      source: "player",
      catalog: w.catalog,
      known: knownEntities(w, [], itemsSeen(w)),
      clock: w.clock,
      causes: [{ kind: "state", entity: w.player, key: "intent" }],
      here: w.truth.get(LOCATION, w.player)?.hex,
    },
  );
}

function stepOf(r: DraftResult): { verb: string; args: unknown[] } {
  if (r.kind !== "plan" || r.plan.root.kind !== "do") throw new Error(r.kind);
  return { verb: r.plan.root.verb, args: [...r.plan.root.args] };
}

describe("«uso el hacha» se vuelve su verbo (use-tools-rewrite)", () => {
  it("cada herramienta va a su oficio, con ella de instrumento", () => {
    const w = Life.create(7, content, { frequency: 8 }).world;
    const axe = hold(w, 1, "axe");
    const hoe = hold(w, 2, "hoe");
    const sickle = hold(w, 3, "sickle");
    expect(stepOf(use(w, "hacha"))).toEqual({
      verb: "gather",
      args: [
        { role: "what", text: "leña" },
        { role: "with", entity: axe },
      ],
    });
    expect(stepOf(use(w, "azada"))).toEqual({
      verb: "work",
      args: [{ role: "with", entity: hoe }],
    });
    // La hoz siega por defecto; «para juntar espigas» la lleva a juntar.
    expect(stepOf(use(w, "hoz")).verb).toBe("work");
    expect(stepOf(use(w, "hoz", "juntar espigas"))).toEqual({
      verb: "gather",
      args: [{ role: "with", entity: sickle }],
    });
  }, 300_000);

  it("los roles que nombran las funciones existen en su verbo", () => {
    const w = Life.create(7, content, { frequency: 8 }).world;
    for (const shape of ["axe", "hoe", "knife", "sickle"]) {
      const offers = w.catalog.affordances(shape);
      expect(offers.length, shape).toBeGreaterThan(0);
      // Las que son otro verbo (afilar es `use` propio: use-tools-mend-sharpen).
      for (const a of offers.filter((o) => o.as !== undefined)) {
        const verb = w.catalog.verb(a.as ?? "");
        expect(
          verb?.args.some((x) => x.role === a.asRole),
          a.id,
        ).toBe(true);
        expect(
          verb?.instruments.some((t) => t.shapes.includes(shape)),
          a.id,
        ).toBe(true);
      }
    }
  }, 300_000);
});

describe("la herramienta como instrumento (use-tools-arg)", () => {
  it("«junto hongos con el cuchillo» usa el que lleva encima", () => {
    const life = Life.create(7, content, { frequency: 8 });
    const w = life.world;
    const knife = knifeOf(w, true);
    const made = gather(w);
    expect(withOf(made)).toBe(knife);
    if (made.kind !== "plan") throw new Error(made.kind);
    const report = life.turn(made.plan, 1);
    const effect = report.steps.find((s) => s.verb === "gather")?.self.effect;
    if (effect?.kind !== "gather") throw new Error("no es gather");
    // Juntó con el cuchillo (o no había nada que juntar), y el cuchillo sigue en su mano.
    if (effect.amount > 0) expect(effect.tool).toBe(knife);
    expect(w.truth.get(ITEM_HOLD, knife)?.possession).toBe(w.player);
    // Si la usó, se gastó lo que dice el paso (use-tools-wear).
    if (effect.tool !== undefined) {
      expect(effect.toolWear).toBeGreaterThan(0);
      expect(w.truth.get(ITEM_WEAR, knife)?.wear).toBe(effect.toolWear);
    } else expect(w.truth.get(ITEM_WEAR, knife)).toBeUndefined();
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  }, 300_000);

  it("el replay de un motor anterior no gasta la herramienta (legacyNoToolWear)", () => {
    const life = Life.create(7, content, { frequency: 8, legacyNoToolWear: true });
    const w = life.world;
    const knife = knifeOf(w, true);
    const made = gather(w);
    if (made.kind !== "plan") throw new Error(made.kind);
    const report = life.turn(made.plan, 1);
    const effect = report.steps.find((s) => s.verb === "gather")?.self.effect;
    expect(effect).not.toHaveProperty("toolWear");
    expect(w.truth.get(ITEM_WEAR, knife)).toBeUndefined();
  }, 300_000);

  it("si no lleva el cuchillo, junta a mano en vez de preguntar", () => {
    const life = Life.create(7, content, { frequency: 8 });
    const w = life.world;
    knifeOf(w, false);
    const made = gather(w);
    expect(made.kind).toBe("plan");
    expect(withOf(made)).toBeUndefined();
  }, 300_000);
});
