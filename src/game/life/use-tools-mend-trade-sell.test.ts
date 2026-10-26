import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  type EventId,
  externalAccount,
  type HolderRef,
  holderAccount,
  type ItemId,
  loadContent,
  makeId,
} from "../../core/index.ts";
import {
  type ActionPlan,
  COPPER,
  checkInvariants,
  ENTITY,
  ITEM_HOLD,
  ITEM_LOOK,
  ITEM_WEAR,
  LOCATION,
  PERSON,
  usedPrice,
  WAGES_SINK,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";
import { smithOf } from "./smith.ts";
import { type LifeWorld, living } from "./world.ts";

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

const acct = (who: AgentId) => holderAccount(who as unknown as HolderRef);

/** Deja exactamente `amount` de cobre en la bolsa de `who`. */
function setCopper(w: LifeWorld, who: AgentId, amount: number): void {
  const have = w.ledger.balance(acct(who), COPPER);
  if (have === amount) return;
  w.ledger.post({
    tick: 0,
    eventId: makeId("event", 1),
    transfers: [
      have > amount
        ? { unit: COPPER, from: acct(who), to: externalAccount(WAGES_SINK), amount: have - amount }
        : { unit: COPPER, from: externalAccount("seed"), to: acct(who), amount: amount - have },
    ],
  });
}

/** Una cosa de la forma `shape` en la mano de `who`, con el desgaste `wear`. */
function hold(w: LifeWorld, n: number, who: AgentId, shape: string, wear: number): ItemId {
  const id = makeId("item", 990 + n);
  w.truth.set(ENTITY, id, { id, createdAt: 0, originEventId: "event:1" as EventId });
  w.truth.set(ITEM_LOOK, id, { shape, material: "iron", size: "medium" });
  w.truth.set(ITEM_HOLD, id, { possession: who as never, rights: [] });
  w.truth.set(ITEM_WEAR, id, { wear, ground: 0 });
  return id;
}

/** Lo de la forma `shape` que tiene la casa de `who` (no en su mano). */
function houseOf(w: LifeWorld, who: AgentId, shape: string): ItemId[] {
  const home = w.truth.get(PERSON, who)?.household as unknown;
  return w.truth
    .ids(ITEM_HOLD)
    .filter(
      (id) =>
        w.truth.get(ITEM_HOLD, id)?.possession === home &&
        w.truth.get(ITEM_LOOK, id)?.shape === shape,
    ) as ItemId[];
}

/** Una vida con herramientas en las casas y un vecino adulto (no el herrero) junto al personaje. */
function withNeighbour(legacy = false) {
  const life = Life.create(7, content, {
    frequency: 8,
    householdTools: true,
    ...(legacy ? { legacyNoUsedTrade: true } : {}),
  });
  const w = life.world;
  const mine = w.truth.get(PERSON, w.player)?.household;
  const smith = smithOf(w.truth);
  const n = living(w.truth).find((id) => {
    const p = w.truth.get(PERSON, id);
    return p !== undefined && p.household !== mine && id !== smith && id !== w.player;
  });
  if (n === undefined) throw new Error("sin vecino");
  const here = w.truth.get(LOCATION, w.player);
  if (here === undefined) throw new Error("sin lugar");
  w.truth.set(LOCATION, n, { ...here });
  setCopper(w, w.player, 100);
  setCopper(w, n, 100);
  return { life, w, n };
}

/** «le vendo / le compro <what> a <n>», hasta que el trato se resuelve (cierra o falta algo). */
function trade(life: Life, n: AgentId, what: string) {
  const w = life.world;
  for (let seq = 1; seq <= 12; seq++) {
    const plan: ActionPlan = {
      actor: w.player,
      source: "player",
      root: {
        kind: "do",
        verb: "trade",
        args: [
          { role: "with", entity: n },
          { role: "what", text: what },
        ],
        manner: [],
      },
      manner: [],
      causes: [{ kind: "state", entity: w.player, key: "intent" }],
    };
    const step = life.turn(plan, seq).steps.find((s) => s.verb === "trade");
    const e = step?.self.effect as { deal?: boolean; lack?: string } | undefined;
    if (e?.deal || e?.lack) return step;
  }
  throw new Error("el trato nunca se resolvió");
}

describe("comprar y vender una herramienta usada (use-tools-mend-trade-sell)", () => {
  it("el precio baja con el desgaste y nunca llega a cero", () => {
    expect(usedPrice(20, 0)).toBe(14);
    expect(usedPrice(20, 0.5)).toBe(7);
    expect(usedPrice(20, 1)).toBe(1);
    expect(usedPrice(40, 0.25)).toBeGreaterThan(usedPrice(40, 0.75));
  });

  it("le vende su hoz a un vecino cuya casa solo tiene una peor: cobra y la hoz pasa al vecino", () => {
    const { life, w, n } = withNeighbour();
    for (const id of houseOf(w, n, "sickle")) w.truth.set(ITEM_WEAR, id, { wear: 0.9, ground: 0 });
    const sickle = hold(w, 1, w.player, "sickle", 0.2);
    const e = trade(life, n, "mi hoz")?.self.effect as { coins: number };
    expect(e).toMatchObject({ kind: "trade", deal: true, direction: "sell", usedItem: sickle });
    expect(e.coins).toBeGreaterThanOrEqual(8);
    expect(e.coins).toBeLessThanOrEqual(15);
    expect(w.ledger.balance(acct(w.player), COPPER)).toBe(100 + e.coins);
    expect(w.ledger.balance(acct(n), COPPER)).toBe(100 - e.coins);
    expect(w.truth.get(ITEM_HOLD, sickle)?.possession).toBe(n);
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  }, 300_000);

  it("el vecino no la quiere si en su casa ya hay una igual menos gastada", () => {
    const { life, w, n } = withNeighbour();
    const theirs = houseOf(w, n, "sickle");
    if (theirs.length === 0) hold(w, 2, n, "sickle", 0);
    for (const id of theirs) w.truth.set(ITEM_WEAR, id, { wear: 0, ground: 0 });
    const sickle = hold(w, 1, w.player, "sickle", 0.6);
    const step = trade(life, n, "la hoz");
    expect(step?.self.effect).toMatchObject({ kind: "trade", deal: false, lack: "want" });
    expect(step?.self.believed).toBe("failure");
    expect(w.truth.get(ITEM_HOLD, sickle)?.possession).toBe(w.player);
    expect(w.ledger.balance(acct(w.player), COPPER)).toBe(100);
  }, 300_000);

  it("le compra el hacha al vecino que tiene otra en casa; sin otra, no la suelta", () => {
    const rich = withNeighbour();
    if (houseOf(rich.w, rich.n, "axe").length === 0) {
      const home = rich.w.truth.get(PERSON, rich.n)?.household as unknown as AgentId;
      hold(rich.w, 3, home, "axe", 0);
    }
    const axe = hold(rich.w, 1, rich.n, "axe", 0.4);
    const e = trade(rich.life, rich.n, "el hacha")?.self.effect as { coins: number };
    expect(e).toMatchObject({ kind: "trade", deal: true, direction: "buy", usedItem: axe });
    expect(rich.w.ledger.balance(acct(rich.w.player), COPPER)).toBe(100 - e.coins);
    expect(rich.w.truth.get(ITEM_HOLD, axe)?.possession).toBe(rich.w.player);

    const only = withNeighbour();
    const away = only.w.truth.get(PERSON, only.w.player)?.household as unknown as HolderRef;
    for (const id of houseOf(only.w, only.n, "axe"))
      only.w.truth.set(ITEM_HOLD, id, { possession: away, rights: [] });
    const lone = hold(only.w, 1, only.n, "axe", 0.4);
    const step = trade(only.life, only.n, "el hacha");
    expect(step?.self.effect).toMatchObject({ kind: "trade", deal: false, lack: "spare" });
    expect(only.w.truth.get(ITEM_HOLD, lone)?.possession).toBe(only.n);
  }, 300_000);

  it("con legacyNoUsedTrade la hoz no cambia de manos", () => {
    const { life, w, n } = withNeighbour(true);
    const sickle = hold(w, 1, w.player, "sickle", 0.2);
    for (let seq = 1; seq <= 4; seq++) {
      const plan: ActionPlan = {
        actor: w.player,
        source: "player",
        root: {
          kind: "do",
          verb: "trade",
          args: [
            { role: "with", entity: n },
            { role: "what", text: "mi hoz" },
          ],
          manner: [],
        },
        manner: [],
        causes: [{ kind: "state", entity: w.player, key: "intent" }],
      };
      const e = life.turn(plan, seq).steps.find((s) => s.verb === "trade")?.self.effect;
      expect((e as { usedItem?: string } | undefined)?.usedItem).toBeUndefined();
    }
    expect(w.truth.get(ITEM_HOLD, sickle)?.possession).toBe(w.player);
  }, 300_000);
});
