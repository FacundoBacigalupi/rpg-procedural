import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type ContentSource,
  externalAccount,
  type HolderRef,
  holderAccount,
  type LedgerUnit,
  loadContent,
  makeId,
} from "../../core/index.ts";
import {
  type ActionPlan,
  COPPER,
  checkInvariants,
  HOUSEHOLD_TOOLS,
  ITEM_HOLD,
  ITEM_LOOK,
  LOCATION,
  PERSON,
  WAGES_SINK,
  WORKSHOP_WASTE,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { forgeToolNamed } from "./act.ts";
import { knownEntities } from "./known.ts";
import { Life } from "./life.ts";
import { IRON_UNIT, smithOf } from "./smith.ts";
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

type Account = ReturnType<typeof holderAccount>;
const me = (w: LifeWorld) => holderAccount(w.player as unknown as HolderRef);
const copperOf = (w: LifeWorld) => w.ledger.balance(me(w), COPPER);

/** Deja exactamente `amount` de `unit` en la cuenta. */
function setBalance(
  w: LifeWorld,
  who: Account,
  unit: LedgerUnit,
  amount: number,
  sink = WAGES_SINK,
): void {
  const have = w.ledger.balance(who, unit);
  if (have === amount) return;
  w.ledger.post({
    tick: 0,
    eventId: makeId("event", 1),
    transfers: [
      have > amount
        ? { unit, from: who, to: externalAccount(sink), amount: have - amount }
        : { unit, from: externalAccount("seed"), to: who, amount: amount - have },
    ],
  });
}

/** Una vida con herramientas en las casas y el herrero en el mismo espacio que el personaje. */
function withSmith(legacy = false) {
  const life = Life.create(7, content, {
    frequency: 8,
    householdTools: true,
    ...(legacy ? { legacyNoForgeBuy: true } : {}),
  });
  const w = life.world;
  const smith = smithOf(w.truth);
  if (smith === undefined) throw new Error("sin herrero");
  const here = w.truth.get(LOCATION, w.player);
  if (here === undefined) throw new Error("sin lugar");
  w.truth.set(LOCATION, smith, { ...here });
  const forge = holderAccount(w.truth.get(PERSON, smith)?.household as unknown as HolderRef);
  return { life, w, smith, forge };
}

function tradePlan(w: LifeWorld, smith: string, what: string): ActionPlan {
  return {
    actor: w.player,
    source: "player",
    root: {
      kind: "do",
      verb: "trade",
      args: [
        { role: "with", entity: smith as never },
        { role: "what", text: what },
      ],
      manner: [],
    },
    manner: [],
    causes: [{ kind: "state", entity: w.player, key: "intent" }],
  };
}

/** «le compro una hoz al herrero», hasta que el trato se resuelve (cierra o falta algo). */
function buy(life: Life, smith: string, what = "una hoz") {
  for (let seq = 1; seq <= 12; seq++) {
    const step = life
      .turn(tradePlan(life.world, smith, what), seq)
      .steps.find((s) => s.verb === "trade");
    const e = step?.self.effect as { deal?: boolean; lack?: string } | undefined;
    if (e?.deal || e?.lack) return step;
  }
  throw new Error("el trato nunca se resolvió");
}

const sickles = (w: LifeWorld) =>
  w.truth
    .ids(ITEM_HOLD)
    .filter(
      (id) =>
        w.truth.get(ITEM_HOLD, id)?.possession === (w.player as unknown) &&
        w.truth.get(ITEM_LOOK, id)?.shape === "sickle",
    );

describe("comprarle una herramienta nueva al herrero (use-tools-mend-trade-buy)", () => {
  it("las herramientas forjables se nombran por su palabra", () => {
    const forgeable = content.all(HOUSEHOLD_TOOLS).filter((t) => t.forge !== undefined);
    expect(forgeToolNamed(forgeable, "una hoz")?.id).toBe("sickle");
    expect(forgeToolNamed(forgeable, "un hacha nueva")?.id).toBe("axe");
    expect(forgeToolNamed(forgeable, "la azada")?.id).toBe("hoe");
    expect(forgeToolNamed(forgeable, "un cuchillo")?.id).toBe("kitchen-knife");
    expect(forgeToolNamed(forgeable, "una olla")).toBeUndefined();
    expect(forgeToolNamed(forgeable, "2 kilos de grano")).toBeUndefined();
  });

  it("el herrero, si el personaje lo conoce, se llama «herrero» o «herrera»", () => {
    const { w, smith } = withSmith();
    const seen = [
      {
        sourceEntityId: smith,
        fields: { identity: { value: smith, confidence: 1 } },
      },
    ] as never;
    const known = knownEntities(w, seen).find((k) => k.ref === smith);
    expect(known?.names.some((n) => n === "herrero" || n === "herrera")).toBe(true);
  }, 300_000);

  it("con cobre, el herrero forja la hoz: cobra, gasta hierro de su hogar y la hoz nueva es del personaje", () => {
    const { life, w, smith, forge } = withSmith();
    setBalance(w, me(w), COPPER, 100);
    const ironBefore = w.ledger.balance(forge, IRON_UNIT);
    const before = sickles(w).length;
    const e = buy(life, smith)?.self.effect as { coins: number };
    expect(e).toMatchObject({
      kind: "trade",
      deal: true,
      direction: "buy",
      forged: "sickle",
      forgedName: "hoz",
      iron: 600,
    });
    expect(e.coins).toBeGreaterThanOrEqual(14);
    expect(e.coins).toBeLessThanOrEqual(26);
    expect(copperOf(w)).toBe(100 - e.coins);
    expect(w.ledger.balance(forge, IRON_UNIT)).toBe(ironBefore - 600);
    expect(sickles(w).length).toBe(before + 1);
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  }, 300_000);

  it("sin cobre no hay hoz; sin hierro en la fragua tampoco", () => {
    const poor = withSmith();
    setBalance(poor.w, me(poor.w), COPPER, 0);
    const before = sickles(poor.w).length;
    const s1 = buy(poor.life, poor.smith);
    expect(s1?.self.effect).toMatchObject({ kind: "trade", deal: false, lack: "copper" });
    expect(s1?.self.believed).toBe("failure");
    expect(sickles(poor.w).length).toBe(before);

    const dry = withSmith();
    setBalance(dry.w, me(dry.w), COPPER, 100);
    setBalance(dry.w, dry.forge, IRON_UNIT, 0, WORKSHOP_WASTE);
    const s2 = buy(dry.life, dry.smith);
    expect(s2?.self.effect).toMatchObject({ kind: "trade", deal: false, lack: "iron" });
    expect(copperOf(dry.w)).toBe(100);
  }, 300_000);

  it("con legacyNoForgeBuy el trato con el herrero no forja nada", () => {
    const { life, w, smith } = withSmith(true);
    setBalance(w, me(w), COPPER, 100);
    const before = sickles(w).length;
    for (let seq = 1; seq <= 4; seq++) {
      const e = life.turn(tradePlan(w, smith, "una hoz"), seq).steps.find((s) => s.verb === "trade")
        ?.self.effect as { forged?: string } | undefined;
      expect(e?.forged).toBeUndefined();
    }
    expect(sickles(w).length).toBe(before);
  }, 300_000);
});
