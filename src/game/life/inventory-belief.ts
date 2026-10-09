// Lo que el personaje cree que tiene (player-loop §9, information): una foto de sus bienes de la
// última vez que los revisó. Si le sacan algo sin que lo note, la foto no cambia y el panel
// `inventario` sigue mostrándolo hasta que vuelve a revisar. Pura: no lee el mundo, el juego le
// pasa los saldos reales cuando el personaje los cuenta.

import type { LedgerUnit, Tick } from "../../core/index.ts";
import { table } from "../../sim/index.ts";

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
export const INVENTORY_BELIEF = table<InventoryBelief>("life.inventoryBelief");

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
