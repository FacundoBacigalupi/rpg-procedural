import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type ContentSource,
  type HolderRef,
  holderAccount,
  loadContent,
} from "../../core/index.ts";
import {
  checkInvariants,
  goodUnit,
  type IntentDraft,
  LOCATION,
  PERSON,
  PLACE,
  placeAt,
  placeRefOf,
  planFromDraft,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { knownEntities, knownSpaces } from "./known.ts";
import { Life } from "./life.ts";

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

const take = (what: string): IntentDraft =>
  ({
    kind: "act",
    plan: { kind: "do", verb: "take", args: [{ role: "what", text: what }] },
  }) as IntentDraft;

describe("agarrar de la despensa (play-refs-objects-larder)", () => {
  it("en su casa, lo que nombra y no está suelto sale del hogar, con conservación", () => {
    const life = Life.create(7, content, { frequency: 8 });
    const w = life.world;
    const at = w.truth.get(LOCATION, w.player);
    const household = w.truth.get(PERSON, w.player)?.household;
    if (at === undefined || household === undefined) throw new Error("sin casa");
    expect(w.spaces.spaces.find((s) => s.key === at.space)?.household).toBe(household);
    const places = w.truth.ids(PLACE).flatMap((id) => {
      const place = w.truth.get(PLACE, id);
      return place ? [{ id, place }] : [];
    });
    const loose = new Set(
      w.ledger
        .holdings(holderAccount(placeRefOf(w.map, placeAt(places, at.hex))))
        .filter((h) => h.amount > 0)
        .map((h) => h.unit),
    );
    const home = holderAccount(household as unknown as HolderRef);
    // Un bien con nombre que la casa tiene guardado y no está suelto en el lugar.
    const stored = w.goods.find((g) => {
      const unit = goodUnit(g);
      return g.form === "good" && !loose.has(unit) && w.ledger.balance(home, unit) > 0;
    });
    if (stored === undefined) throw new Error("la despensa está vacía");
    const unit = goodUnit(stored);
    const before = w.ledger.balance(home, unit);

    const known = knownEntities(w);
    const made = planFromDraft(take(stored.name), {
      actor: w.player,
      source: "player",
      catalog: w.catalog,
      known,
      clock: w.clock,
      causes: [{ kind: "state", entity: w.player, key: "intent" }],
      here: at.hex,
      spaces: knownSpaces(w, known),
    });
    if (made.kind !== "plan") throw new Error(made.kind);
    const report = life.turn(made.plan, 1);
    const effect = report.steps.find((s) => s.verb === "take")?.self.effect;
    expect(effect).toMatchObject({ kind: "take", from: household, wanted: unit });
    const mine = w.ledger.balance(holderAccount(w.player as unknown as HolderRef), unit);
    if (effect?.kind === "take" && effect.got.length > 0) {
      expect(mine).toBeGreaterThan(0);
      expect(w.ledger.balance(home, unit)).toBeLessThan(before);
    }
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  }, 300_000);
});
