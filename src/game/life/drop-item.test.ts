import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type ContentSource,
  type EventId,
  holderAccount,
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

/** Le da al personaje un cuchillo que lleva encima. */
function carry(w: LifeWorld): ItemId {
  const id = makeId("item", 950);
  w.truth.set(ENTITY, id, { id, createdAt: 0, originEventId: "event:1" as EventId });
  w.truth.set(ITEM_LOOK, id, { shape: "knife", material: "iron", size: "small" });
  w.truth.set(ITEM_HOLD, id, { possession: w.player as never, rights: [] });
  return id;
}

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

describe("soltar lo que lleva (play-refs-objects-source-drop)", () => {
  it("«suelto el cuchillo» lo deja donde está, a la vista, sin tocar el ledger", () => {
    const life = Life.create(7, content, { frequency: 8, itemClaims: true });
    const w = life.world;
    const knife = carry(w);
    // Lo que lleva no se busca para agarrar: «agarro el cuchillo» no es el suyo.
    expect(whatOf(plan(w, "take", "el cuchillo"))).toBe("el cuchillo");
    const made = plan(w, "drop", "el cuchillo");
    expect(whatOf(made)).toBe(knife);
    if (made.kind !== "plan") throw new Error(made.kind);
    const lots = w.ledger.holdings(holderAccount(w.player as never));
    const report = life.turn(made.plan, 1);
    const effect = report.steps.find((s) => s.verb === "drop")?.self.effect;
    expect(effect).toMatchObject({ kind: "drop", item: knife, dropped: true, got: [] });
    expect(w.truth.get(ITEM_HOLD, knife)?.possession).not.toBe(w.player);
    expect(w.truth.get(LOCATION, knife)).toEqual(w.truth.get(LOCATION, w.player));
    expect(w.ledger.holdings(holderAccount(w.player as never))).toEqual(lots);
    // Ya no lo lleva: soltarlo de nuevo no lo encuentra entre lo suyo; si lo ve, agarrarlo sí
    // (que lo vea depende de la luz y la tirada de percepción, no de soltarlo).
    expect(whatOf(plan(w, "drop", "el cuchillo"))).toBe("el cuchillo");
    if (itemsSeen(w).some((p) => p.sourceEntityId === knife)) {
      expect(whatOf(plan(w, "take", "el cuchillo"))).toBe(knife);
    }
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  }, 300_000);

  it("sin claims un objeto no se suelta como lote (no tira todo lo demás)", () => {
    const life = Life.create(7, content, { frequency: 8 });
    const w = life.world;
    const knife = carry(w);
    const made = plan(w, "drop", "el cuchillo");
    expect(whatOf(made)).toBe(knife);
    if (made.kind !== "plan") throw new Error(made.kind);
    const lots = w.ledger.holdings(holderAccount(w.player as never));
    const report = life.turn(made.plan, 1);
    const effect = report.steps.find((s) => s.verb === "drop")?.self.effect;
    expect(effect).toMatchObject({ kind: "drop", got: [] });
    expect(w.truth.get(ITEM_HOLD, knife)?.possession).toBe(w.player);
    expect(w.ledger.holdings(holderAccount(w.player as never))).toEqual(lots);
  }, 300_000);
});
