// Lo que el personaje cree que tiene (player-loop §9, information): una foto de sus bienes de la
// última vez que los revisó. Si le sacan algo sin que lo note, la foto no cambia y el panel
// `inventario` sigue mostrándolo hasta que vuelve a revisar. Pura: no lee el mundo, el juego le
// pasa los saldos reales cuando el personaje los cuenta.

import type { AgentId, Event, HolderRef, LedgerUnit, Tick } from "../../core/index.ts";
import { holderAccount } from "../../core/index.ts";
import { COPPER, PERSON, type ProcessDef, setComponent, table } from "../../sim/index.ts";

export interface BelievedHolding {
  readonly unit: LedgerUnit;
  readonly amount: number;
}

export interface InventoryBelief {
  /** El momento del mundo en que lo revisó. */
  readonly asOf: Tick;
  /** Lo que lleva encima (con las monedas de cobre). */
  readonly carried: readonly BelievedHolding[];
  /** Lo que cree que hay en la despensa de su casa. */
  readonly larder: readonly BelievedHolding[];
}

/** Lo que cada persona cree tener, en su entidad. */
export const INVENTORY_BELIEF = table<InventoryBelief>("life.inventory_belief");

const positive = (hs: readonly BelievedHolding[]): BelievedHolding[] =>
  hs
    .filter((h) => h.amount > 0)
    .map((h) => ({ unit: h.unit, amount: h.amount }))
    .sort((a, b) => (a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : 0));

/** Revisar: lo que hay ahora pasa a ser lo que cree. */
export function checkInventory(
  carried: readonly BelievedHolding[],
  larder: readonly BelievedHolding[],
  now: Tick,
): InventoryBelief {
  return { asOf: now, carried: positive(carried), larder: positive(larder) };
}

/**
 * Notó que algo cambió (lo gastó, lo dio, vio el hueco): corrige solo esa unidad y deja el resto
 * como lo creía. Es lo que distingue un robo que no notó (no se llama) de uno que sí.
 */
export function noticeChange(
  belief: InventoryBelief,
  where: "carried" | "larder",
  unit: LedgerUnit,
  amount: number,
  now: Tick,
): InventoryBelief {
  const rest = belief[where].filter((h) => h.unit !== unit);
  return { ...belief, asOf: now, [where]: positive([...rest, { unit, amount }]) };
}

// --- El juego escribe la foto -------------------------------------------------------------------
// Qué unidades tocó lo que hizo el personaje y si eran de la despensa. Lo lee un proceso `perceive`
// sobre los eventos del paso, así el turno y el replay (mismo `submit`/`advanceTo`) la escriben igual.

/** Lo que `touchedBy` lee del efecto del verbo (ver `VerbEffect`). */
interface EffectGist {
  readonly kind?: string;
  readonly good?: unknown;
  readonly coins?: number;
  readonly from?: unknown;
  readonly wanted?: unknown;
  readonly got?: unknown;
}

export interface Touched {
  readonly unit: LedgerUnit;
  /** Lo que llevaba encima. */
  readonly carried: boolean;
  /** La despensa de la casa. */
  readonly larder: boolean;
}

/** Las unidades que el personaje tocó en este evento (y sabe que tocó): gastar, dar, comer, guardar. */
export function touchedBy(e: Event, household: HolderRef | null): Touched[] {
  const data = e.data as { effect?: EffectGist } | null;
  const fx = data?.effect;
  if (!fx || typeof fx.kind !== "string") return [];
  const out: Touched[] = [];
  const hs = (v: unknown): v is readonly { unit: LedgerUnit }[] => Array.isArray(v);
  const ofLarder = (from: unknown) => household !== null && from === household;
  const add = (unit: unknown, carried: boolean, larder: boolean) => {
    if (typeof unit === "string") out.push({ unit: unit as LedgerUnit, carried, larder });
  };
  switch (fx.kind) {
    case "trade":
      add(fx.good, true, false);
      if (fx.coins) add(COPPER, true, false);
      break;
    case "work":
      add(COPPER, true, false);
      break;
    case "give":
    case "gather":
      add(fx.good, true, false);
      break;
    case "eat":
    case "cook":
      add(fx.good, !ofLarder(fx.from), ofLarder(fx.from));
      break;
    case "take":
      add(fx.wanted, true, ofLarder(fx.from));
      if (hs(fx.got)) for (const h of fx.got) add(h.unit, true, ofLarder(fx.from));
      break;
    case "store":
      if (hs(fx.got)) for (const h of fx.got) add(h.unit, true, true);
      break;
  }
  return out;
}

export const INVENTORY_PROCESS = "life.inventory";

export interface InventoryOptions {
  readonly player: AgentId;
}

/**
 * Lo que el personaje nota de sus bienes: al usar algo (comer, dar, comprar, guardar) corrige solo
 * esa unidad; si todavía no tiene foto (vida anterior) cuenta todo. Lo que le sacan sin que lo
 * toque él no pasa por acá, y la foto lo sigue mostrando.
 */
export function inventoryProcess(o: InventoryOptions): ProcessDef {
  return {
    id: INVENTORY_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "onEvent", scene: "onEvent" },
    representation: "individual",
    phase: "perceive",
    reads: [PERSON.name, INVENTORY_BELIEF.name],
    writes: [INVENTORY_BELIEF.name],
    run(ctx) {
      const mine = ctx.recent.filter((e) => e.actors.includes(o.player));
      const me = ctx.truth.get(PERSON, o.player);
      if (mine.length === 0 || !me || !ctx.ledger) return {};
      const ledger = ctx.ledger;
      const household = me.household as unknown as HolderRef;
      const held = (h: HolderRef, unit: LedgerUnit) =>
        ledger.holdings(holderAccount(h)).find((x) => x.unit === unit)?.amount ?? 0;
      let belief = ctx.truth.get(INVENTORY_BELIEF, o.player);
      if (!belief) {
        belief = checkInventory(
          ledger.holdings(holderAccount(o.player as HolderRef)),
          ledger.holdings(holderAccount(household)),
          ctx.now,
        );
      } else {
        for (const e of mine) {
          for (const t of touchedBy(e, household)) {
            if (t.carried) {
              belief = noticeChange(
                belief,
                "carried",
                t.unit,
                held(o.player as HolderRef, t.unit),
                e.tick,
              );
            }
            if (t.larder)
              belief = noticeChange(belief, "larder", t.unit, held(household, t.unit), e.tick);
          }
        }
      }
      return { changes: [setComponent(INVENTORY_BELIEF, o.player, belief)] };
    },
  };
}
