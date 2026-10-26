import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
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
  COPPER,
  checkInvariants,
  type DraftResult,
  ENTITY,
  type IntentDraft,
  ITEM_HOLD,
  ITEM_LOOK,
  ITEM_WEAR,
  LOCATION,
  mendQuote,
  PERSON,
  planFromDraft,
  WAGES_SINK,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { knownEntities, knownSpaces } from "./known.ts";
import { Life } from "./life.ts";
import { IRON_UNIT, SMITH, smithOf } from "./smith.ts";
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

/** «arreglo mi hoz» como lo deja la gramática. */
function mend(w: LifeWorld): DraftResult {
  return planFromDraft(
    {
      kind: "act",
      plan: {
        kind: "do",
        verb: "use",
        args: [
          { role: "target", ref: { text: "mi hoz", kind: "object", features: ["hoz", "mía"] } },
          { role: "how", text: "arreglar" },
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

const me = (w: LifeWorld) => holderAccount(w.player as unknown as HolderRef);
const copperOf = (w: LifeWorld) => w.ledger.balance(me(w), COPPER);

/** Le deja al personaje exactamente `amount` de cobre. */
function setCopper(w: LifeWorld, amount: number): void {
  const have = copperOf(w);
  if (have === amount) return;
  w.ledger.post({
    tick: 0,
    eventId: makeId("event", 1),
    transfers: [
      have > amount
        ? { unit: COPPER, from: me(w), to: externalAccount(WAGES_SINK), amount: have - amount }
        : { unit: COPPER, from: externalAccount("seed"), to: me(w), amount: amount - have },
    ],
  });
}

/** Una vida con herramientas en las casas y el herrero en el mismo espacio que el personaje. */
function withSmith(present: boolean) {
  const life = Life.create(7, content, { frequency: 8, householdTools: true });
  const w = life.world;
  const smith = smithOf(w.truth);
  if (smith === undefined) throw new Error("sin herrero");
  const here = w.truth.get(LOCATION, w.player);
  if (here === undefined) throw new Error("sin lugar");
  const away = w.spaces.spaces.find((s) => s.key !== here.space)?.key;
  w.truth.set(LOCATION, smith, present ? { ...here } : { ...here, space: away });
  const forge = holderAccount(w.truth.get(PERSON, smith)?.household as unknown as HolderRef);
  return { life, w, smith, forge };
}

describe("el herrero arregla la herramienta (use-tools-mend-smith)", () => {
  it("con householdTools hay un herrero adulto con hierro en su hogar; legacyNoSmith no lo tiene", () => {
    const { w, smith, forge } = withSmith(true);
    const level = w.truth.get(SMITH, smith)?.level ?? 0;
    expect(level).toBeGreaterThanOrEqual(0.3);
    expect(level).toBeLessThanOrEqual(0.7);
    expect(smith).not.toBe(w.player);
    expect(w.ledger.balance(forge, IRON_UNIT)).toBeGreaterThan(0);
    expect(w.log.all().some((e) => e.kind === "smith.chosen" && e.actors[0] === smith)).toBe(true);
    const names = knownSpaces(w, []).flatMap((s) => s.names);
    expect(names).toContain("la herrería");
    const legacy = Life.create(7, content, {
      frequency: 8,
      householdTools: true,
      legacyNoSmith: true,
    }).world;
    expect(smithOf(legacy.truth)).toBeUndefined();
  }, 300_000);

  it("con el herrero acá y cobre, le repone metal y filo, cobra y pone hierro de su hogar", () => {
    const { life, w, smith, forge } = withSmith(true);
    const sickle = hold(w, 1, "sickle");
    w.truth.set(ITEM_WEAR, sickle, { wear: 0.8, ground: 0.3 });
    setCopper(w, 100);
    const level = w.truth.get(SMITH, smith)?.level ?? 0;
    const quote = mendQuote(0.8, 0.3, level);
    const ironBefore = w.ledger.balance(forge, IRON_UNIT);
    const forgeCopper = w.ledger.balance(forge, COPPER);
    const smithCopper = w.ledger.balance(holderAccount(smith as unknown as HolderRef), COPPER);
    const made = mend(w);
    if (made.kind !== "plan" || made.plan.root.kind !== "do") throw new Error(made.kind);
    expect(made.plan.root.args).toEqual([
      { role: "target", entity: sickle },
      { role: "how", text: "tool.mend" },
    ]);
    const effect = life.turn(made.plan, 1).steps.find((s) => s.verb === "use")?.self.effect;
    expect(effect).toMatchObject({
      kind: "use",
      how: "tool.mend",
      mended: true,
      smith,
      paid: quote.cost,
      iron: quote.iron,
    });
    expect(w.truth.get(ITEM_WEAR, sickle)).toEqual({ wear: quote.ground, ground: quote.ground });
    expect(quote.ground).toBeLessThan(0.3);
    expect(copperOf(w)).toBe(100 - quote.cost);
    const paidTo =
      w.ledger.balance(holderAccount(smith as unknown as HolderRef), COPPER) - smithCopper;
    expect(paidTo + (w.ledger.balance(forge, COPPER) - forgeCopper)).toBe(quote.cost);
    expect(w.ledger.balance(forge, IRON_UNIT)).toBe(ironBefore - quote.iron);
    expect(w.truth.get(SMITH, smith)?.level ?? 0).toBeGreaterThan(level);
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  }, 300_000);

  it("sin el herrero en el lugar no se hace: no está acá y la hoz queda igual", () => {
    const { life, w } = withSmith(false);
    const sickle = hold(w, 1, "sickle");
    w.truth.set(ITEM_WEAR, sickle, { wear: 0.8, ground: 0.3 });
    setCopper(w, 100);
    const made = mend(w);
    if (made.kind !== "plan") throw new Error(JSON.stringify(made).slice(0, 800));
    const step = life.turn(made.plan, 1).steps.find((s) => s.verb === "use");
    expect(step?.self.effect).toMatchObject({ kind: "use", mended: false, lack: "smith" });
    expect(step?.self.believed).toBe("failure");
    expect(w.truth.get(ITEM_WEAR, sickle)).toEqual({ wear: 0.8, ground: 0.3 });
    expect(copperOf(w)).toBe(100);
  }, 300_000);

  it("sin cobre para pagarle no hay con qué", () => {
    const { life, w, forge } = withSmith(true);
    const sickle = hold(w, 1, "sickle");
    w.truth.set(ITEM_WEAR, sickle, { wear: 0.8, ground: 0.3 });
    setCopper(w, 0);
    const iron = w.ledger.balance(forge, IRON_UNIT);
    const made = mend(w);
    if (made.kind !== "plan") throw new Error(JSON.stringify(made).slice(0, 800));
    const step = life.turn(made.plan, 1).steps.find((s) => s.verb === "use");
    expect(step?.self.effect).toMatchObject({ kind: "use", mended: false, lack: "copper" });
    expect(step?.self.believed).toBe("failure");
    expect(w.truth.get(ITEM_WEAR, sickle)).toEqual({ wear: 0.8, ground: 0.3 });
    expect(w.ledger.balance(forge, IRON_UNIT)).toBe(iron);
  }, 300_000);
});
