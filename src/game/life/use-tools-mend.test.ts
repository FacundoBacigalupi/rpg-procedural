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
  SHARPEN_GRIND,
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

/** Una cosa de la forma `shape` en manos del personaje. */
function hold(w: LifeWorld, n: number, shape: string, material = "iron"): ItemId {
  const id = makeId("item", 980 + n);
  w.truth.set(ENTITY, id, { id, createdAt: 0, originEventId: "event:1" as EventId });
  w.truth.set(ITEM_LOOK, id, { shape, material, size: "medium" });
  w.truth.set(ITEM_HOLD, id, { possession: w.player as never, rights: [] });
  return id;
}

/** «afilo la hoz» como lo deja la gramática. */
function sharpen(w: LifeWorld): DraftResult {
  return planFromDraft(
    {
      kind: "act",
      plan: {
        kind: "do",
        verb: "use",
        args: [
          { role: "target", ref: { text: "la hoz", kind: "object", features: ["hoz"] } },
          { role: "how", text: "afilar" },
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

describe("afilar la herramienta gastada (use-tools-mend-sharpen)", () => {
  it("con la piedra encima, «afilo la hoz» le saca filo y le come un poco de metal", () => {
    const life = Life.create(7, content, { frequency: 8 });
    const w = life.world;
    const sickle = hold(w, 1, "sickle");
    hold(w, 2, "whetstone", "stone");
    w.truth.set(ITEM_WEAR, sickle, { wear: 0.8, ground: 0.1 });
    const made = sharpen(w);
    if (made.kind !== "plan" || made.plan.root.kind !== "do") throw new Error(made.kind);
    expect(made.plan.root.verb).toBe("use");
    expect(made.plan.root.args).toEqual([
      { role: "target", entity: sickle },
      { role: "how", text: "tool.sharpen" },
    ]);
    const report = life.turn(made.plan, 1);
    const effect = report.steps.find((s) => s.verb === "use")?.self.effect;
    if (effect?.kind !== "use") throw new Error("no es use");
    expect(effect.how).toBe("tool.sharpen");
    expect(effect.means).toBe(true);
    const row = w.truth.get(ITEM_WEAR, sickle);
    if ((effect.honed ?? 0) > 0) {
      // Recuperó filo, nunca por debajo del metal comido, y el metal comido subió.
      expect(row?.wear).toBeLessThan(0.8);
      expect(row?.ground).toBeCloseTo(0.1 + SHARPEN_GRIND * (effect.honed ?? 0), 6);
      expect(row?.wear ?? 0).toBeGreaterThanOrEqual(row?.ground ?? 0);
    } else expect(row).toEqual({ wear: 0.8, ground: 0.1 });
    expect(w.truth.get(ITEM_HOLD, sickle)?.possession).toBe(w.player);
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  }, 300_000);

  it("sin piedra no hay con qué y la hoz queda como estaba", () => {
    const life = Life.create(7, content, { frequency: 8 });
    const w = life.world;
    const sickle = hold(w, 1, "sickle");
    w.truth.set(ITEM_WEAR, sickle, { wear: 0.8 });
    const made = sharpen(w);
    if (made.kind !== "plan") throw new Error(made.kind);
    const step = life.turn(made.plan, 1).steps.find((s) => s.verb === "use");
    expect(step?.self.effect).toMatchObject({ kind: "use", means: false, honed: 0 });
    expect(w.truth.get(ITEM_WEAR, sickle)).toEqual({ wear: 0.8 });
  }, 300_000);

  it("las casas de dos o más tienen su piedra; el replay de un motor anterior no (legacyNoSharpen)", () => {
    const stones = (legacy: boolean) => {
      const w = Life.create(7, content, {
        frequency: 8,
        householdTools: true,
        ...(legacy ? { legacyNoSharpen: true } : {}),
      }).world;
      return [...w.truth.ids(ITEM_LOOK)].filter(
        (id) => w.truth.get(ITEM_LOOK, id)?.shape === "whetstone",
      ).length;
    };
    expect(stones(false)).toBeGreaterThan(0);
    expect(stones(true)).toBe(0);
  }, 300_000);

  it("el replay de un motor anterior no afila (legacyNoSharpen)", () => {
    const life = Life.create(7, content, { frequency: 8, legacyNoSharpen: true });
    const w = life.world;
    const sickle = hold(w, 1, "sickle");
    hold(w, 2, "whetstone", "stone");
    w.truth.set(ITEM_WEAR, sickle, { wear: 0.8 });
    const made = sharpen(w);
    if (made.kind !== "plan") throw new Error(made.kind);
    const step = life.turn(made.plan, 1).steps.find((s) => s.verb === "use");
    expect(step?.self.effect).toEqual({ kind: "none" });
    expect(w.truth.get(ITEM_WEAR, sickle)).toEqual({ wear: 0.8 });
  }, 300_000);
});
