import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, type ItemId, loadContent } from "../../core/index.ts";
import {
  checkInvariants,
  type DraftResult,
  type IntentDraft,
  ITEM_HOLD,
  ITEM_LOOK,
  LOCATION,
  PERSON,
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

function plan(w: LifeWorld, verb: string, text: string): DraftResult {
  return planFromDraft(
    {
      kind: "act",
      plan: { kind: "do", verb, args: [{ role: "what", text }] },
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

function whatOf(r: DraftResult): string | undefined {
  if (r.kind !== "plan" || r.plan.root.kind !== "do") return undefined;
  const a = r.plan.root.args.find((x) => x.role === "what");
  return a === undefined ? undefined : "entity" in a ? a.entity : "text" in a ? a.text : undefined;
}

describe("el jugador agarra una cosa de su casa (perfil2-item-claims-item-demand-player)", () => {
  it("con el perfil de objetos, «agarro la olla» toma esa olla y «la suelto» la deja", () => {
    const life = Life.create(7, content, { frequency: 8, itemClaims: true, householdTools: true });
    const w = life.world;
    const pot = itemsSeen(w)
      .map((p) => p.sourceEntityId as ItemId)
      .find((id) => w.truth.get(ITEM_LOOK, id)?.shape === "pot");
    if (pot === undefined) throw new Error("no ve la olla");
    const owner = w.truth.get(ITEM_HOLD, pot)?.possession;
    expect(String(owner)).toBe(String(w.truth.get(PERSON, w.player)?.household));

    const took = plan(w, "take", "la olla");
    expect(whatOf(took)).toBe(pot);
    if (took.kind !== "plan") throw new Error(took.kind);
    const r1 = life.turn(took.plan, 1);
    expect(r1.steps.find((s) => s.verb === "take")?.self.effect).toMatchObject({
      item: pot,
      claimed: true,
    });
    expect(w.truth.get(ITEM_HOLD, pot)?.possession).toBe(w.player);

    const dropped = plan(w, "drop", "la olla");
    expect(whatOf(dropped)).toBe(pot);
    if (dropped.kind !== "plan") throw new Error(dropped.kind);
    life.turn(dropped.plan, 1);
    expect(w.truth.get(ITEM_HOLD, pot)?.possession).not.toBe(w.player);
    expect(w.truth.get(LOCATION, pot)).toEqual(w.truth.get(LOCATION, w.player));
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  }, 300_000);
});
