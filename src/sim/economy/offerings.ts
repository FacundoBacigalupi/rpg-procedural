// Ofrendas como lotes con destino (spirits §6, §11; economy «Fuentes y sumideros»). Una ofrenda es
// un lote de bienes que sale de la bolsa de un hogar y termina en una cuenta de destino: lo quemado
// se vuelve ceniza (sumidero real `OFFERING_ASH`), lo enterrado sigue existiendo bajo tierra (cuenta
// del lugar, botín de saqueadores y de la arqueología), lo dado a los pobres es una transferencia
// y lo que se come la familia no se mueve de su despensa. Nada desaparece sin pasar a una cuenta.
// Puro: no escribe nada ni tira RNG; el cableado (`game/life/offerings.ts`) arma el asiento.

import type { LedgerAccount, LedgerUnit, Transfer } from "../../core/index.ts";

/** A donde va lo que se quema en una ofrenda (ceniza y humo de bienes del ledger). */
export const OFFERING_ASH = "offering-ash";

export const OFFERING_DISPOSALS = [
  "burned",
  "buried",
  "given_to_poor",
  "eaten_by_performers",
] as const;
export type OfferingDisposal = (typeof OFFERING_DISPOSALS)[number];

/** Qué parte del lote va a cada destino (se normaliza: solo importan las proporciones). */
export type OfferingMix = Readonly<Partial<Record<OfferingDisposal, number>>>;

/** La ración que se deja a la tablilla: casi toda la come después la familia (spirits §6). */
export const HEARTH_MIX: OfferingMix = { burned: 0.25, eaten_by_performers: 0.75 };
/** La fiesta: se reparte a los pobres, se quema, se entierra un poco y el resto lo comen en la mesa. */
export const FESTIVAL_MIX: OfferingMix = {
  given_to_poor: 0.4,
  burned: 0.2,
  buried: 0.1,
  eaten_by_performers: 0.3,
};

/** Fracción de la despensa de grano que un hogar sincero ofrenda cada vez (sin calibrar). */
export const HEARTH_SHARE = 0.004;
export const FESTIVAL_SHARE = 0.02;

/**
 * Gramos (enteros) que un hogar pone en el lote: parte de su despensa × sinceridad (0-1), nunca más
 * de lo que tiene. Sin despensa o sin sinceridad no ofrenda nada.
 */
export function offeredAmount(stock: number, share: number, sincerity: number): number {
  if (!(stock > 0) || !(share > 0) || !(sincerity > 0)) return 0;
  const want = Math.floor(stock * Math.min(1, share) * Math.min(1, sincerity));
  return Math.max(0, Math.min(Math.floor(stock), want));
}

/**
 * Reparte `total` (entero) entre los destinos del mix con el método del mayor resto: suma exacta,
 * orden fijo por `OFFERING_DISPOSALS` y desempate estable. Un mix sin pesos deja todo comido.
 */
export function splitLot(total: number, mix: OfferingMix): Record<OfferingDisposal, number> {
  const out = Object.fromEntries(OFFERING_DISPOSALS.map((d) => [d, 0])) as Record<
    OfferingDisposal,
    number
  >;
  const n = Math.max(0, Math.floor(total));
  const weights = OFFERING_DISPOSALS.map((d) => Math.max(0, mix[d] ?? 0));
  const sum = weights.reduce((a, b) => a + b, 0);
  if (n === 0) return out;
  if (!(sum > 0)) {
    out.eaten_by_performers = n;
    return out;
  }
  const exact = weights.map((w) => (w / sum) * n);
  const floors = exact.map((x) => Math.floor(x));
  let left = n - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((x, i) => ({ i, r: x - Math.floor(x) }))
    .sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    if ((weights[i] as number) > 0) {
      floors[i] = (floors[i] as number) + 1;
      left--;
    }
  }
  OFFERING_DISPOSALS.forEach((d, i) => {
    out[d] = floors[i] as number;
  });
  return out;
}

export interface OfferingAccounts {
  /** La bolsa de quien ofrenda (de donde sale el lote). */
  readonly from: LedgerAccount;
  /** El sumidero de la ceniza (`externalAccount(OFFERING_ASH)`). */
  readonly ash: LedgerAccount;
  /** Donde queda enterrado (el lugar del santuario o la tumba). */
  readonly buried: LedgerAccount;
  /** El hogar más necesitado, si lo hay; sin él, esa parte la come la familia. */
  readonly poor?: LedgerAccount;
}

export interface OfferingLot {
  readonly unit: LedgerUnit;
  readonly total: number;
  /** Cuánto fue a cada destino (suma `total`). */
  readonly parts: Record<OfferingDisposal, number>;
  /** Las transferencias del ledger; lo comido por la familia no se mueve. */
  readonly transfers: readonly Transfer[];
}

/** El lote con su destino: partes por disposición y las transferencias que las asientan. Puro. */
export function offeringLot(
  unit: LedgerUnit,
  total: number,
  mix: OfferingMix,
  accounts: OfferingAccounts,
): OfferingLot {
  const parts = splitLot(total, mix);
  if (accounts.poor === undefined || accounts.poor === accounts.from) {
    parts.eaten_by_performers += parts.given_to_poor;
    parts.given_to_poor = 0;
  }
  const dest: [OfferingDisposal, LedgerAccount | undefined][] = [
    ["burned", accounts.ash],
    ["buried", accounts.buried],
    ["given_to_poor", accounts.poor],
  ];
  const transfers: Transfer[] = [];
  for (const [d, to] of dest) {
    if (to !== undefined && parts[d] > 0) {
      transfers.push({ unit, from: accounts.from, to, amount: parts[d] });
    }
  }
  return { unit, total: Math.max(0, Math.floor(total)), parts, transfers };
}

/** El hogar con menos en la despensa (desempate por id), salvo `except`; undefined si no hay otro. */
export function poorestHousehold(
  stocks: ReadonlyMap<string, number>,
  except: string,
): string | undefined {
  let best: string | undefined;
  for (const id of [...stocks.keys()].sort()) {
    if (id === except) continue;
    if (best === undefined || (stocks.get(id) as number) < (stocks.get(best) as number)) best = id;
  }
  return best;
}
