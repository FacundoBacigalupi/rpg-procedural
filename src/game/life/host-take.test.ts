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
import { goodsInSight, missingGoodsNote } from "./goods-sight.ts";
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

describe("agarrar en casa ajena (play-refs-objects-source)", () => {
  it("lo que nombra sale de la despensa de ese hogar, se ve antes y se conserva", () => {
    const life = Life.create(7, content, { frequency: 8 });
    const w = life.world;
    const at = w.truth.get(LOCATION, w.player);
    const mine = w.truth.get(PERSON, w.player)?.household;
    if (at === undefined) throw new Error("sin lugar");
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
    // Una casa de otro hogar que guarda un bien con nombre que no está suelto.
    let pick: { space: string; host: HolderRef; good: (typeof w.goods)[number] } | undefined;
    for (const s of w.spaces.spaces) {
      if (!s.indoor || s.household === undefined || s.household === mine) continue;
      const host = s.household as unknown as HolderRef;
      const good = w.goods.find(
        (g) =>
          g.form === "good" &&
          !loose.has(goodUnit(g)) &&
          w.ledger.balance(holderAccount(host), goodUnit(g)) > 0,
      );
      if (good) {
        pick = { space: s.key, host, good };
        break;
      }
    }
    if (pick === undefined) throw new Error("ninguna casa ajena con despensa");
    w.truth.set(LOCATION, w.player, { ...at, space: pick.space });
    const unit = goodUnit(pick.good);
    const account = holderAccount(pick.host);
    const before = w.ledger.balance(account, unit);
    expect(goodsInSight(w).some((g) => g.where === "host" && g.unit === unit)).toBe(true);

    const known = knownEntities(w);
    const made = planFromDraft(take(pick.good.name), {
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
    expect(missingGoodsNote(w, made.plan.root)).toBeUndefined();
    const report = life.turn(made.plan, 1);
    const effect = report.steps.find((s) => s.verb === "take")?.self.effect;
    expect(effect).toMatchObject({ kind: "take", from: pick.host, wanted: unit });
    if (effect?.kind === "take" && effect.got.length > 0) {
      expect(w.ledger.balance(account, unit)).toBeLessThan(before);
    }
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  }, 300_000);
});
