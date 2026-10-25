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
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
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
