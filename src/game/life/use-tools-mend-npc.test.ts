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
  type LedgerAccount,
  type LedgerUnit,
  loadContent,
  makeId,
} from "../../core/index.ts";
import {
  COPPER,
  ENTITY,
  houseKey,
  ITEM_HOLD,
  ITEM_LOOK,
  ITEM_WEAR,
  mendQuote,
  PERSON,
  SHARPEN_GRIND,
  WORKSHOP_WASTE,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { engineOptions, Life } from "./life.ts";
import {
  careForTool,
  ROUTINE_TOOL_MENDED,
  ROUTINE_TOOL_RETURNED,
  ROUTINE_TOOL_SHARPENED,
  routineToolStep,
} from "./routine-tools.ts";
import { IRON_UNIT, SMITH, smithOf } from "./smith.ts";
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

const place = { kind: "place" as const, place: "place:1" as never };

/** Saldos fijos por cuenta: el ledger que ve el cuidado de la herramienta. */
function balances(table: Record<string, number>) {
  return {
    balance: (a: LedgerAccount, u: LedgerUnit) => table[`${a}|${u}`] ?? 0,
  };
}

function stoneOf(w: LifeWorld, household: string): boolean {
  return w.truth
    .ids(ITEM_HOLD)
    .some(
      (id) =>
        w.truth.get(ITEM_HOLD, id)?.possession === (household as unknown as HolderRef) &&
        w.truth.get(ITEM_LOOK, id)?.shape === "whetstone",
    );
}

/** Una vida con herramientas en las casas, un vecino (no el herrero) con piedra en su casa y el herrero. */
function setup() {
  const life = Life.create(7, content, { frequency: 8, householdTools: true });
  const w = life.world;
  const smith = smithOf(w.truth);
  if (smith === undefined) throw new Error("sin herrero");
  const n = living(w.truth).find((id) => {
    const h = w.truth.get(PERSON, id)?.household;
    return h !== undefined && id !== smith && id !== w.player && stoneOf(w, h);
  });
  if (n === undefined) throw new Error("sin vecino con piedra");
  const household = w.truth.get(PERSON, n)?.household as string;
  const forge = w.truth.get(PERSON, smith)?.household as string;
  return { life, w, n, household, smith, forge };
}

/** Una hoz en la mano de `who` con el desgaste dado. */
function sickle(w: LifeWorld, who: AgentId, wear: number, ground: number): ItemId {
  const id = makeId("item", 991);
  w.truth.set(ENTITY, id, { id, createdAt: 0, originEventId: "event:1" as EventId });
  w.truth.set(ITEM_LOOK, id, { shape: "sickle", material: "iron", size: "medium" });
  w.truth.set(ITEM_HOLD, id, { possession: who as never, rights: [] });
  w.truth.set(ITEM_WEAR, id, { wear, ground });
  return id;
}

const acct = (who: string) => holderAccount(who as unknown as HolderRef);

describe("los NPC afilan y llevan al herrero la herramienta de la casa (use-tools-mend-npc)", () => {
  it("mellada y con piedra en la casa, la afila: recupera el filo y come un poco de metal", () => {
    const { w, n, household } = setup();
    const tool = sickle(w, n, 0.6, 0.1);
    const care = careForTool(w.truth, n, household, tool, balances({}), place);
    expect(care?.event.kind).toBe(ROUTINE_TOOL_SHARPENED);
    const ground = 0.1 + SHARPEN_GRIND * 0.5;
    expect(care?.event.data).toMatchObject({ item: tool, wear: ground, ground });
    expect(care?.transfers).toEqual([]);
  }, 300_000);

  it("con poco filo perdido no la toca", () => {
    const { w, n, household } = setup();
    const tool = sickle(w, n, 0.2, 0.05);
    expect(careForTool(w.truth, n, household, tool, balances({}), place)).toBeUndefined();
  }, 300_000);

  it("con mucho metal comido la lleva al herrero: le paga, el herrero pone hierro y sube de oficio", () => {
    const { w, n, household, smith, forge } = setup();
    const tool = sickle(w, n, 0.7, 0.4);
    const level = w.truth.get(SMITH, smith)?.level ?? 0;
    const q = mendQuote(0.7, 0.4, level);
    const care = careForTool(
      w.truth,
      n,
      household,
      tool,
      balances({ [`${acct(n)}|${COPPER}`]: 50, [`${acct(forge)}|${IRON_UNIT}`]: 5000 }),
      place,
    );
    expect(care?.event.kind).toBe(ROUTINE_TOOL_MENDED);
    expect(care?.event.actors).toEqual([n, smith]);
    expect(care?.transfers).toEqual([
      { from: acct(n), to: acct(smith), unit: COPPER, amount: q.cost },
      { from: acct(forge), to: externalAccount(WORKSHOP_WASTE), unit: IRON_UNIT, amount: q.iron },
    ]);
    const wear = care?.changes.find((c) => c.table === ITEM_WEAR.name);
    expect(wear).toMatchObject({ value: { wear: q.ground, ground: q.ground } });
    const up = care?.changes.find((c) => c.table === SMITH.name) as
      | { value: { level: number } }
      | undefined;
    expect(up?.value.level).toBeGreaterThan(level);
  }, 300_000);

  it("sin cobre para el herrero se arregla con la piedra; sin hierro en la fragua, igual", () => {
    const { w, n, household, forge } = setup();
    const tool = sickle(w, n, 0.8, 0.4);
    const broke = careForTool(
      w.truth,
      n,
      household,
      tool,
      balances({ [`${acct(forge)}|${IRON_UNIT}`]: 5000 }),
      place,
    );
    expect(broke?.event.kind).toBe(ROUTINE_TOOL_SHARPENED);
    const noIron = careForTool(
      w.truth,
      n,
      household,
      tool,
      balances({ [`${acct(n)}|${COPPER}`]: 50 }),
      place,
    );
    expect(noIron?.event.kind).toBe(ROUTINE_TOOL_SHARPENED);
  }, 300_000);

  it("al volver a la casa la deja y la cuida en el mismo paso, con el asiento citando el arreglo", () => {
    const { w, n, household, forge } = setup();
    sickle(w, n, 0.7, 0.4);
    const home = houseKey(household as never);
    const step = routineToolStep({
      truth: w.truth,
      me: n,
      household,
      home,
      here: { hex: 0 as never },
      there: { hex: 0 as never, space: home },
      atFields: false,
      working: true,
      instruments: [{ shapes: ["sickle"], rate: 1.5, hours: 40 }] as never,
      place,
      mend: balances({ [`${acct(n)}|${COPPER}`]: 50, [`${acct(forge)}|${IRON_UNIT}`]: 5000 }),
    });
    expect(step.events.map((e) => e.kind)).toEqual([ROUTINE_TOOL_RETURNED, ROUTINE_TOOL_MENDED]);
    expect(step.postings?.map((p) => p.at)).toEqual([1]);
  }, 300_000);

  it("los motores anteriores a life-55 no cuidan la herramienta", () => {
    expect(engineOptions("life-54", {})).toMatchObject({ legacyNoNpcMend: true });
    expect(engineOptions("life-55", {})).not.toHaveProperty("legacyNoNpcMend");
  });
});
