// El zapatero de la aldea (npc-b2b3b2b3a, crafts, economy): un adulto de la aldea hace de zapatero
// con una habilidad propia que mejora con cada arreglo, guarda cuero como bien del ledger y cobra a
// quien le lleva el calzado gastado (el cobre pasa del cliente al zapatero, ya no al sumidero).
// El cuero tiene origen: entra al bolsillo del zapatero desde `HIDES_SOURCE` (las pieles del monte y
// del matadero, de fuera de la simulación mientras no haya ganado ni caza que las dé; ver
// npc-b2b3b2b3b) con un evento que lo cita, y lo que gasta el arreglo va a `LEATHER_SCRAP`. Opt-in
// (`LifeParts.npcCobbler`, con `npcFootwearMend`): apagado todo sigue como en `life-25`.

import { type HolderRef, type LedgerUnit, ledgerUnit } from "../../core/index.ts";
import { table } from "../../sim/index.ts";

/** El zapatero y qué tan bueno es (0 torpe, 1 maestro). Una fila por persona que lo fue. */
export interface Cobbler {
  readonly level: number;
}

export const COBBLER = table<Cobbler>("life.cobbler");

/** De donde entra el cuero que no sale de otra cuenta de la simulación (pieles de fuera). */
export const HIDES_SOURCE = "hides";
/** A donde va el cuero que gasta el arreglo. */
export const LEATHER_SCRAP = "leather-scrap";

export const LEATHER_GOOD = "leather";
export const LEATHER_UNIT: LedgerUnit = ledgerUnit(`good:${LEATHER_GOOD}`);

/** Gramos de cuero de un remiendo y de un par nuevo (sin calibrar). */
export const MEND_LEATHER = 200;
export const NEW_PAIR_LEATHER = 800;
/** Cuánto cuero junta de una vez cuando le falta (gramos). */
export const LEATHER_BATCH = 3000;
/** Edad mínima (años) para hacer de zapatero. */
export const COBBLER_MIN_AGE = 16;

const round = (x: number) => Math.round(x * 1e6) / 1e6;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Nivel de arranque del zapatero según un número de 0 a 1 (ya sabe algo del oficio). */
export function startLevel(u: number): number {
  return round(0.15 + 0.3 * clamp01(u));
}

/** Nivel tras un arreglo: sube hacia el techo del oficio, cada vez menos. Puro. */
export function levelAfterJob(level: number): number {
  const ceiling = 0.9;
  return round(Math.min(ceiling, level + (ceiling - level) * 0.04));
}

/** Qué parte del desgaste deja un remiendo según el oficio del zapatero (0,5 torpe, 0,2 maestro). */
export function mendKeeps(level: number): number {
  return round(0.5 - 0.3 * clamp01(level));
}

/** Gramos de cuero que pide el arreglo. */
export function leatherFor(kind: "mend" | "replace"): number {
  return kind === "replace" ? NEW_PAIR_LEATHER : MEND_LEATHER;
}

/** Gramos que hay que juntar para tener `need` si tiene `have`: nada, o el lote (o lo justo si es más). */
export function leatherToFetch(have: number, need: number): number {
  if (have >= need) return 0;
  return Math.max(need - have, LEATHER_BATCH);
}

/** Cobre por kilo de piel que el zapatero compra al curtidor de fuera (npc-b2b3b2b3b1, sin calibrar). */
export const HIDE_COPPER_PER_KG = 1;

/** Cobre que cuestan `grams` de piel (redondeado hacia arriba, entero). Puro. */
export function hidePrice(grams: number): number {
  return Math.ceil((grams / 1000) * HIDE_COPPER_PER_KG);
}

/**
 * El cuero que el zapatero les compra a las casas de la aldea (livestock-hide-tan-sell), en el orden
 * de `offers`, hasta `want` gramos y con lo que le alcanza de `copper` al mismo precio que la piel de
 * fuera (`hidePrice`, sin calibrar). Lo que no cubren las casas lo trae de fuera. Puro.
 */
export function localLeatherBuys(
  offers: readonly { readonly holder: HolderRef; readonly grams: number }[],
  want: number,
  copper: number,
): { holder: HolderRef; grams: number; cost: number }[] {
  const out: { holder: HolderRef; grams: number; cost: number }[] = [];
  let left = want;
  let purse = copper;
  for (const o of offers) {
    if (left <= 0) break;
    const grams = Math.min(
      Math.floor(o.grams),
      left,
      Math.floor((purse * 1000) / HIDE_COPPER_PER_KG),
    );
    if (grams <= 0) continue;
    const cost = hidePrice(grams);
    out.push({ holder: o.holder, grams, cost });
    left -= grams;
    purse -= cost;
  }
  return out;
}

/**
 * Qué compra el zapatero que tiene `have` g y `copper` cobres para cubrir `need`: el lote de
 * `leatherToFetch` si le alcanza, o solo lo que falta si no; `null` si ni eso le alcanza y el
 * trabajo no se hace. Puro.
 */
export function hideBuy(
  have: number,
  need: number,
  copper: number,
): { grams: number; cost: number } | null {
  const want = leatherToFetch(have, need);
  if (want === 0) return { grams: 0, cost: 0 };
  if (hidePrice(want) <= copper) return { grams: want, cost: hidePrice(want) };
  const missing = need - have;
  if (hidePrice(missing) <= copper) return { grams: missing, cost: hidePrice(missing) };
  return null;
}
