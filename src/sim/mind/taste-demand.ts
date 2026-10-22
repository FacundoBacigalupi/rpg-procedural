// Gustos en la demanda (npc-psychology §16, economy §4): un gusto de comida o bebida mueve lo
// máximo que alguien paga por los bienes que lo satisfacen. Lo que le gusta, lo paga de más; lo que
// le da asco, lo paga de menos. No crea demanda de la nada: solo corre la reserva de compra de
// quien ya está comprando, y el trato sigue sujeto a su presupuesto. Puro; constantes sin calibrar.

import type { Preference, TasteDef } from "./tastes.ts";

/** Cuánto corre la reserva un gusto de máxima valencia y fuerza (0,25 = hasta un cuarto). */
export const TASTE_DEMAND_SWING = 0.25;
/** Dominios cuyo gusto mueve la compra de un bien (los pasatiempos no se compran por kilo). */
export const TASTE_DEMAND_DOMAINS: readonly string[] = ["food.flavor", "food.drink", "food.dish"];

/**
 * Factor sobre la reserva de compra de `good` (id sin el prefijo `good:`): 1 sin gusto que lo toque.
 * Promedia los gustos que lo nombran en `demandGoods` ponderados por su fuerza, para que muchos
 * gustos coincidentes no multipliquen sin tope.
 */
export function tasteDemandFactor(
  prefs: readonly Preference[],
  defs: readonly TasteDef[],
  good: string,
): number {
  let num = 0;
  let den = 0;
  for (const p of prefs) {
    if (!TASTE_DEMAND_DOMAINS.includes(p.domain)) continue;
    const def = defs.find((d) => d.id === p.item);
    if (def === undefined || !def.demandGoods.includes(good)) continue;
    num += p.valence * p.strength;
    den += p.strength;
  }
  if (den === 0) return 1;
  const pull = Math.min(1, Math.max(-1, num / den));
  return Math.round((1 + TASTE_DEMAND_SWING * pull) * 1e6) / 1e6;
}
