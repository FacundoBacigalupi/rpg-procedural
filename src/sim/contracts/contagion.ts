// Cadenas de deuda y contagio de quiebras (contracts §13, economy §8): la red de `Commitment` activos
// como grafo deudor -> acreedor. Quien no puede pagar todo lo que debe paga a prorrata con lo que
// tiene, y eso le falta a su acreedor, que a su vez puede no llegar a pagar lo suyo. Es el clearing
// de Eisenberg-Noe: se parte de que todos pagan todo y se baja hasta el punto fijo (monótono, así
// que termina). Puro, sin RNG ni reloj; una sola unidad por corrida (las unidades no se mezclan).
// No toca ningún estado: devuelve el balance de la red y quién cayó por quién.

import { type Commitment, commitmentOwed } from "./commitment.ts";

export interface DebtEdge {
  readonly debtor: string;
  readonly creditor: string;
  readonly owed: number;
  /** El compromiso de donde sale (para citarlo como causa). */
  readonly commitment: string;
}

export interface ContagionOutcome {
  /** Cuánto paga cada deudor de lo que debe en total (0..1); 1 = paga todo. */
  readonly payRatio: ReadonlyMap<string, number>;
  /** Patrimonio final: activos propios + lo cobrado - lo pagado. */
  readonly equity: ReadonlyMap<string, number>;
  /** Quiénes no pagan todo, en orden de ronda de caída y luego por id. */
  readonly failed: readonly string[];
  /** Ronda (0 = ya cae solo por sus activos) en que cada uno cae. */
  readonly round: ReadonlyMap<string, number>;
  /** Para cada caído después de la ronda 0, los acreedores-deudores caídos de los que le faltó cobrar. */
  readonly because: ReadonlyMap<string, readonly string[]>;
}

/** Aristas de deuda de los compromisos activos en una unidad; las obligaciones sin saldo se omiten. */
export function debtEdges(commitments: readonly Commitment[], unit: string): DebtEdge[] {
  const out: DebtEdge[] = [];
  for (const c of commitments) {
    if (c.status !== "active" && c.status !== "defaulted") continue;
    for (const o of c.obligations) {
      if (o.duty.unit !== unit || o.state === "fulfilled") continue;
      const owed = Math.max(0, o.duty.qty - o.performed);
      if (owed > 0) out.push({ debtor: o.debtor, creditor: o.creditor, owed, commitment: c.id });
    }
  }
  return out;
}

/** Suma de lo debido en la unidad (misma cuenta que `commitmentOwed`, sobre varios). */
export function totalOwed(commitments: readonly Commitment[], unit: string): number {
  let t = 0;
  for (const c of commitments) {
    if (c.obligations.every((o) => o.duty.unit === unit)) t += commitmentOwed(c);
    else for (const e of debtEdges([c], unit)) t += e.owed;
  }
  return t;
}

/**
 * Clearing de la red. `assets` son los activos propios líquidos de cada agente (los ausentes tienen
 * 0). Cada deudor paga `min(1, (activos + cobrado) / deuda total)` de cada deuda, a prorrata; se
 * repite hasta que nadie cambie (o `maxRounds`). Conserva: lo que paga uno lo cobra otro.
 */
export function clearDebts(
  edges: readonly DebtEdge[],
  assets: ReadonlyMap<string, number>,
  maxRounds = 64,
): ContagionOutcome {
  const agents = new Set<string>(assets.keys());
  const liab = new Map<string, number>();
  for (const e of edges) {
    agents.add(e.debtor);
    agents.add(e.creditor);
    liab.set(e.debtor, (liab.get(e.debtor) ?? 0) + e.owed);
  }
  const ids = [...agents].sort();
  const ratio = new Map<string, number>(ids.map((a) => [a, 1]));
  const round = new Map<string, number>();
  const because = new Map<string, string[]>();
  const incoming = (a: string): number => {
    let t = 0;
    for (const e of edges) if (e.creditor === a) t += e.owed * (ratio.get(e.debtor) ?? 1);
    return t;
  };
  for (let r = 0; r < maxRounds; r++) {
    const next = new Map(ratio);
    for (const a of ids) {
      const debt = liab.get(a) ?? 0;
      if (debt <= 0) continue;
      const means = Math.max(0, assets.get(a) ?? 0) + incoming(a);
      next.set(a, Math.min(1, means / debt));
    }
    let changed = false;
    for (const a of ids) {
      const was = ratio.get(a) ?? 1;
      const now = next.get(a) ?? 1;
      if (now < was - 1e-12) {
        changed = true;
        if (was >= 1 && now < 1) {
          round.set(a, r);
          if (r > 0) {
            const why = new Set<string>();
            for (const e of edges)
              if (e.creditor === a && (round.get(e.debtor) ?? Infinity) < r) why.add(e.debtor);
            because.set(a, [...why].sort());
          }
        }
      }
    }
    for (const [a, v] of next) ratio.set(a, Math.min(ratio.get(a) ?? 1, v));
    if (!changed) break;
  }
  const equity = new Map<string, number>();
  for (const a of ids) {
    const paid = (liab.get(a) ?? 0) * (ratio.get(a) ?? 1);
    equity.set(a, Math.max(0, assets.get(a) ?? 0) + incoming(a) - paid);
  }
  const failed = [...round.keys()].sort(
    (x, y) => (round.get(x) ?? 0) - (round.get(y) ?? 0) || (x < y ? -1 : 1),
  );
  return { payRatio: ratio, equity, failed, round, because };
}

/** Atajo: la red de compromisos activos y los activos, de una. */
export function contagion(
  commitments: readonly Commitment[],
  unit: string,
  assets: ReadonlyMap<string, number>,
): ContagionOutcome {
  return clearDebts(debtEdges(commitments, unit), assets);
}
