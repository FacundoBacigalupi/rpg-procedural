// Pool de un proyecto cooperativo (schemes §9, "Recursos y conservación"): todo aporte entra desde
// un participante concreto, todo gasto y todo reparto sale del pool. Las cantidades son enteras
// (unidades del bien: jornales, sacos, monedas) para que la conservación sea exacta:
//   suma(aportes) = saldo + gastado + repartido.
// Todo puro, sin RNG ni reloj; cada asiento lleva el evento que lo causó.

import type { AgentId, EventId } from "../../core/index.ts";

export interface PoolEntry {
  readonly kind: "contribution" | "spend" | "distribution";
  /** Quien aportó o recibió; null en gastos. */
  readonly agent: AgentId | null;
  readonly qty: number;
  readonly eventId: EventId;
  /** En gastos: en qué se fue (comida de la expedición, salarios). */
  readonly reason?: string;
}

export interface Pool {
  /** Qué se junta: jornales de trabajo, grano, plata. */
  readonly good: string;
  readonly balance: number;
  readonly contributed: number;
  readonly spent: number;
  readonly distributed: number;
  readonly entries: readonly PoolEntry[];
}

export function makePool(good: string): Pool {
  return { good, balance: 0, contributed: 0, spent: 0, distributed: 0, entries: [] };
}

const whole = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);

/**
 * Suma un aporte. `available` es lo que el aportante tiene de verdad: nunca entra más que eso, así
 * nada aparece de la nada. Devuelve el pool nuevo y lo realmente movido (el llamador lo descuenta
 * del aportante).
 */
export function addContribution(
  pool: Pool,
  agent: AgentId,
  qty: number,
  available: number,
  eventId: EventId,
): { readonly pool: Pool; readonly moved: number } {
  const moved = Math.min(whole(qty), whole(available));
  if (moved === 0) return { pool, moved: 0 };
  return {
    moved,
    pool: {
      ...pool,
      balance: pool.balance + moved,
      contributed: pool.contributed + moved,
      entries: [...pool.entries, { kind: "contribution", agent, qty: moved, eventId }],
    },
  };
}

/** Gasta del pool (no más que el saldo). Devuelve lo realmente gastado. */
export function spendFromPool(
  pool: Pool,
  qty: number,
  reason: string,
  eventId: EventId,
): { readonly pool: Pool; readonly spent: number } {
  const spent = Math.min(whole(qty), pool.balance);
  if (spent === 0) return { pool, spent: 0 };
  return {
    spent,
    pool: {
      ...pool,
      balance: pool.balance - spent,
      spent: pool.spent + spent,
      entries: [...pool.entries, { kind: "spend", agent: null, qty: spent, eventId, reason }],
    },
  };
}

export interface ShareWeight {
  readonly agent: AgentId;
  /** Peso del reparto (>= 0): partes iguales, aporte, riesgo asumido, lo que dicte el compromiso. */
  readonly weight: number;
}

/**
 * Reparte `total` en enteros por mayor resto: la suma es exactamente `total` (si hay peso). Los
 * empates de resto se rompen por el orden de la lista, que el llamador fija (determinista).
 */
export function splitInteger(total: number, weights: readonly ShareWeight[]): ShareWeight[] {
  const t = whole(total);
  const sum = weights.reduce((a, w) => a + Math.max(0, w.weight), 0);
  if (t === 0 || sum <= 0) return weights.map((w) => ({ agent: w.agent, weight: 0 }));
  const raw = weights.map((w) => (t * Math.max(0, w.weight)) / sum);
  const base = raw.map((r) => Math.floor(r));
  let left = t - base.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const o of order) {
    if (left <= 0) break;
    base[o.i] = (base[o.i] ?? 0) + 1;
    left--;
  }
  return weights.map((w, i) => ({ agent: w.agent, weight: base[i] ?? 0 }));
}

/**
 * Reparte el saldo según los pesos. Devuelve cuánto recibe cada uno (suma = lo repartido). Si
 * nadie tiene peso, el saldo queda en el pool.
 */
export function distributePool(
  pool: Pool,
  weights: readonly ShareWeight[],
  eventId: EventId,
): { readonly pool: Pool; readonly payouts: readonly ShareWeight[] } {
  const payouts = splitInteger(pool.balance, weights);
  const out = payouts.filter((p) => p.weight > 0);
  const total = out.reduce((a, p) => a + p.weight, 0);
  if (total === 0) return { pool, payouts };
  return {
    payouts,
    pool: {
      ...pool,
      balance: pool.balance - total,
      distributed: pool.distributed + total,
      entries: [
        ...pool.entries,
        ...out.map(
          (p): PoolEntry => ({ kind: "distribution", agent: p.agent, qty: p.weight, eventId }),
        ),
      ],
    },
  };
}

/** Invariante de conservación: lo aportado es lo que hay más lo gastado y lo repartido. */
export function poolConserved(pool: Pool): boolean {
  const sum = (k: PoolEntry["kind"]) =>
    pool.entries.filter((e) => e.kind === k).reduce((a, e) => a + e.qty, 0);
  return (
    pool.balance >= 0 &&
    pool.contributed === pool.balance + pool.spent + pool.distributed &&
    sum("contribution") === pool.contributed &&
    sum("spend") === pool.spent &&
    sum("distribution") === pool.distributed
  );
}
