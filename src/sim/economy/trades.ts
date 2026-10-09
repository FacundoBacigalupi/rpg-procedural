// Producción de oficios por hogar y jornales (economy §3 «Oficios», §3 salarios como precio del
// trabajo). Parte pura: una receta convierte insumos en un producto con horas de trabajo, el
// jornal es un precio que sube cuando faltan brazos, y el ingreso medio del hogar sale de lo
// cobrado de verdad (recibos). Todo se expresa como transferencias del ledger: el insumo sale a
// un sumidero y el producto entra desde una fuente nombrada, el jornal pasa de una bolsa a otra.

import {
  contentId,
  defineContent,
  type LedgerAccount,
  type LedgerUnit,
  type Transfer,
  z,
} from "../../core/index.ts";
import { table } from "../world/index.ts";
import { poolIncome } from "./budget.ts";

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Horas de trabajo de un día completo. */
export const WORK_HOURS_PER_DAY = 10;
/** Cuánto puede subir o bajar el jornal respecto del de base por falta o sobra de brazos. */
export const WAGE_MIN_FACTOR = 0.5;
export const WAGE_MAX_FACTOR = 2;

export interface TradeRecipe {
  readonly id: string;
  /** Horas de trabajo de un lote. */
  readonly hoursPerBatch: number;
  /** Insumos por lote (gramos o unidades de cada bien). */
  readonly inputs: readonly { readonly good: string; readonly amount: number }[];
  readonly output: { readonly good: string; readonly amount: number };
}

/** Lotes que se pueden hacer con las horas y los insumos que hay (entero, nunca negativo). */
export function batchesPossible(
  recipe: TradeRecipe,
  hours: number,
  stock: ReadonlyMap<string, number>,
): number {
  let n = Math.floor(Math.max(0, hours) / Math.max(1e-9, recipe.hoursPerBatch));
  for (const i of recipe.inputs) {
    if (i.amount <= 0) continue;
    n = Math.min(n, Math.floor((stock.get(i.good) ?? 0) / i.amount));
  }
  return Math.max(0, n);
}

export interface TradeAccounts {
  /** Quién produce (el hogar o el artesano). */
  readonly workshop: LedgerAccount;
  /** Adónde va lo consumido (merma y desecho). */
  readonly sink: LedgerAccount;
  /** De dónde sale la materia nueva del producto (conserva con origen declarado). */
  readonly source: LedgerAccount;
  readonly unitOf: (good: string) => LedgerUnit;
}

/** Las transferencias de hacer `batches` lotes: los insumos salen del taller y el producto entra. */
export function productionTransfers(
  recipe: TradeRecipe,
  batches: number,
  acc: TradeAccounts,
): readonly Transfer[] {
  if (batches <= 0) return [];
  const out: Transfer[] = [];
  for (const i of recipe.inputs) {
    const amount = Math.round(i.amount * batches);
    if (amount > 0)
      out.push({ unit: acc.unitOf(i.good), from: acc.workshop, to: acc.sink, amount });
  }
  const made = Math.round(recipe.output.amount * batches);
  if (made > 0)
    out.push({
      unit: acc.unitOf(recipe.output.good),
      from: acc.source,
      to: acc.workshop,
      amount: made,
    });
  return out;
}

/**
 * El jornal del día (monedas): el de base movido por cuántos puestos hay por trabajador. Faltan
 * brazos (más puestos que gente) sube hasta el doble; sobran, baja hasta la mitad.
 */
export function wagePerDay(basePerDay: number, workers: number, jobs: number): number {
  if (workers <= 0) return Math.round(basePerDay * WAGE_MAX_FACTOR);
  const ratio = jobs / workers; // 1 = equilibrio
  const factor = clamp(0.5 + 0.5 * ratio, WAGE_MIN_FACTOR, WAGE_MAX_FACTOR);
  return Math.max(0, Math.round(basePerDay * factor));
}

/** Lo que se cobra por `hours` a un jornal diario; el que paga solo da lo que tiene. */
export function wageDue(wageDay: number, hours: number, payerCoins: number): number {
  const due = Math.round((wageDay * clamp(hours, 0, WORK_HOURS_PER_DAY)) / WORK_HOURS_PER_DAY);
  return Math.max(0, Math.min(due, Math.floor(payerCoins)));
}

/** El pago de un jornal como transferencia de monedas del que paga al que trabajó. */
export function wageTransfer(
  coin: LedgerUnit,
  payer: LedgerAccount,
  worker: LedgerAccount,
  coins: number,
): readonly Transfer[] {
  return coins > 0 ? [{ unit: coin, from: payer, to: worker, amount: coins }] : [];
}

export interface IncomeReceipt {
  /** Día (entero) en que se cobró. */
  readonly day: number;
  readonly coins: number;
}

/** Ingreso medio por día del hogar en los últimos `windowDays` días con recibos reales (jornales y ventas). */
export function meanIncomePerDay(
  receipts: readonly IncomeReceipt[],
  today: number,
  windowDays: number,
): number {
  if (windowDays <= 0) return 0;
  let sum = 0;
  for (const r of receipts) if (r.day <= today && r.day > today - windowDays) sum += r.coins;
  return sum / windowDays;
}

/**
 * Lo que cobra cada miembro llega al hogar según su aporte a la bolsa común: devuelve las
 * transferencias de cada miembro a la bolsa de la casa (conserva las monedas).
 */
export function pooledCollection(
  coin: LedgerUnit,
  home: LedgerAccount,
  earned: readonly {
    readonly id: string;
    readonly account: LedgerAccount;
    readonly coins: number;
    readonly pooled: number;
  }[],
): { readonly pot: number; readonly transfers: readonly Transfer[] } {
  const { pot } = poolIncome(earned);
  const transfers: Transfer[] = [];
  for (const e of earned) {
    const give = Math.floor(e.coins * clamp(e.pooled, 0, 1));
    if (give > 0) transfers.push({ unit: coin, from: e.account, to: home, amount: give });
  }
  return { pot, transfers };
}

/** Una receta de oficio como contenido (`content/trades/`): horas, insumos y producto en gramos. */
export const TradeRecipeDef = z.strictObject({
  id: contentId,
  name: z.string().min(1),
  /** Horas de trabajo de un lote. */
  hoursPerBatch: z.number().positive(),
  inputs: z.array(z.strictObject({ good: contentId, amount: z.number().positive() })).default([]),
  output: z.strictObject({ good: contentId, amount: z.number().positive() }),
});
export type TradeRecipeDef = z.infer<typeof TradeRecipeDef>;

export const TRADE_RECIPES = defineContent("trades", TradeRecipeDef, (r) => [
  ...r.inputs.map((i, n) => ({ kind: "goods", id: i.good, at: `inputs.${n}.good` })),
  { kind: "goods", id: r.output.good, at: "output.good" },
]);

/** Los recibos de un hogar (lo realmente cobrado), solo los últimos días. */
export interface IncomeBook {
  readonly receipts: readonly IncomeReceipt[];
}
export const TRADE_RECEIPTS = table<IncomeBook>("economy.trade_receipts");
/** Cuántos días de recibos se guardan y se promedian. */
export const RECEIPT_WINDOW_DAYS = 30;

/** De dónde sale la materia nueva de un producto de oficio y adónde va lo consumido (ledger). */
export const WORKSHOP = "workshop";
export const WORKSHOP_WASTE = "workshop-waste";
