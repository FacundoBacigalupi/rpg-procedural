// Lo que se pudre (economy §1, "perecer es un proceso"): cada bien pierde la mitad cada
// `halfLifeDays`. Lo que se echa a perder no desaparece sin rastro: sale del ledger hacia el
// sumidero `rotted` con su evento. El redondeo es estocástico con el rng con clave, así que la
// pérdida esperada es la de la curva aunque las cantidades sean chicas.

import { type LedgerUnit, pow, type Rng } from "../../core/index.ts";
import type { GoodDef } from "./goods.ts";
import { goodUnit } from "./goods.ts";

/** Fracción que se pudre en `days` días con esa vida media. */
export function rotFraction(halfLifeDays: number, days: number): number {
  return 1 - pow(0.5, days / halfLifeDays);
}

/** Cuánto se pudre de cada fila en `days` días: solo lo perecible, solo lo que pasa de cero. */
export function spoilage(
  held: readonly { readonly unit: LedgerUnit; readonly amount: number }[],
  goods: readonly GoodDef[],
  days: number,
  rng: Rng,
): { unit: LedgerUnit; amount: number }[] {
  const life = new Map(
    goods.flatMap((g) =>
      g.halfLifeDays === undefined ? [] : [[goodUnit(g), g.halfLifeDays] as const],
    ),
  );
  const out: { unit: LedgerUnit; amount: number }[] = [];
  for (const row of held) {
    const half = life.get(row.unit);
    if (half === undefined) continue;
    const exact = row.amount * rotFraction(half, days);
    const amount = Math.min(row.amount, Math.floor(exact) + (rng.float() < exact % 1 ? 1 : 0));
    if (amount > 0) out.push({ unit: row.unit, amount });
  }
  return out;
}
