import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type ContentSource,
  externalAccount,
  holderAccount,
  loadContent,
  type PlaceId,
} from "../../core/index.ts";
import {
  checkInvariants,
  type IntentDraft,
  LOCATION,
  PLACE,
  planFromDraft,
  WILD,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { knownEntities } from "./known.ts";
import { Life } from "./life.ts";
import { FIREWOOD_UNIT, FORAGE_UNIT, WILD_SOURCE, WILD_SUPPLIED_EVENT } from "./wild.ts";
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
const DAY = 86400;

function forestOf(w: LifeWorld): { place: PlaceId; hex: number } {
  const place = w.truth.ids(PLACE).find((p) => w.truth.get(PLACE, p)?.kind === "forest");
  const hex = place === undefined ? undefined : w.truth.get(PLACE, place)?.hexes[0];
  if (place === undefined || hex === undefined) throw new Error("sin monte");
  return { place: place as unknown as PlaceId, hex };
}

/** El jugador, parado en el monte, junta lo que nombra (o lo de siempre, sin nombrar nada). */
function gatherAt(life: Life, text: string | null) {
  const w = life.world;
  w.truth.set(LOCATION, w.player, { hex: forestOf(w).hex });
  const r = planFromDraft(
    {
      kind: "act",
      plan: {
        kind: "do",
        verb: "gather",
        args: text === null ? [] : [{ role: "what", text }],
      },
    } as IntentDraft,
    {
      actor: w.player,
      source: "player",
      catalog: w.catalog,
      known: knownEntities(w, []),
      clock: w.clock,
      causes: [{ kind: "state", entity: w.player, key: "intent" }],
      here: w.truth.get(LOCATION, w.player)?.hex,
    },
  );
  if (r.kind !== "plan") throw new Error(r.kind);
  const turn = life.turn(r.plan, 1);
  return turn.steps.find((s) => s.verb === "gather")?.self.effect as
    | { good: string | null; amount: number }
    | undefined;
}

describe("la leña del monte (hearth-wood)", () => {
  it("con wildFirewood el monte tiene leña caída y cada lugar de monte recibe su parte", () => {
    const life = Life.create(7, content, { wildHarvest: true, wildFirewood: true });
    const w = life.world;
    life.advanceTo(life.now + DAY);
    const [eco] = w.truth.ids(WILD);
    expect(eco).toBeDefined();
    expect(w.truth.get(WILD, eco as never)?.deadwood ?? 0).toBeGreaterThan(0);
    const at = holderAccount({ kind: "place", place: forestOf(w).place });
    expect(w.ledger.balance(at, FIREWOOD_UNIT)).toBeGreaterThan(0);
    expect(w.ledger.balance(externalAccount(WILD_SOURCE), FIREWOOD_UNIT)).toBeLessThan(0);
    const supplied = w.log.all().filter((e) => e.kind === WILD_SUPPLIED_EVENT);
    expect(supplied.some((e) => (e.data as { firewood?: unknown }).firewood !== undefined)).toBe(
      true,
    );
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  }, 300_000);

  it("«junto leña» saca leña del monte; sin nombrarla, sale el forraje de siempre", () => {
    const life = Life.create(7, content, { wildHarvest: true, wildFirewood: true });
    const w = life.world;
    life.advanceTo(life.now + DAY);
    const wood = gatherAt(life, "leña");
    expect(wood?.good).toBe(FIREWOOD_UNIT);
    expect(w.ledger.balance(holderAccount(w.player), FIREWOOD_UNIT)).toBe(wood?.amount ?? -1);
    expect(wood?.amount ?? 0).toBeGreaterThan(0);
    expect(gatherAt(life, null)?.good).toBe(FORAGE_UNIT);
    expect(w.ledger.audit()).toEqual([]);
  }, 300_000);

  it("apagado, el monte no tiene leña y «junto leña» junta lo de siempre", () => {
    const life = Life.create(7, content, { wildHarvest: true });
    const w = life.world;
    life.advanceTo(life.now + DAY);
    const [eco] = w.truth.ids(WILD);
    expect(w.truth.get(WILD, eco as never)?.deadwood).toBeUndefined();
    expect(gatherAt(life, "leña")?.good).toBe(FORAGE_UNIT);
  }, 300_000);

  it("determinista: misma corrida, mismo hash", () => {
    const run = () => {
      const life = Life.create(7, content, { wildHarvest: true, wildFirewood: true });
      life.advanceTo(life.now + 3 * DAY);
      return life.hash().total;
    };
    expect(run()).toBe(run());
  }, 300_000);
});
