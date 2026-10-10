// El oficio que el personaje oyó de un vecino (economy §3, information §4) como lo que es: algo
// que cree de oídas, no la verdad. Sale de su libro de rumores de molde (`MOLD_RUMORS`, `attr`
// `trade`) y entra a la vista con las palabras que él usaría (el oficio por su nombre, la casa por
// alguien que conoce de ella); nunca ids de hogar ni de receta. Opt-in (`PlayerViewOptions`).

import type { AgentId, Rng } from "../../core/index.ts";
import { PERSON, type TradeRecipeDef } from "../../sim/index.ts";
import type { HeardTradeView } from "../view/index.ts";
import { MOLD_RUMORS, type MoldBook } from "./moldgossip.ts";
import { acquaintances } from "./witness.ts";
import type { LifeWorld } from "./world.ts";

/** Desde qué confianza lo que oyó lo cuenta como seguro (sin calibrar). */
export const HEARD_TRADE_SURE = 0.5;
/** Cuántas veces de cada tantas lo trae a la cabeza en un turno (sin calibrar). */
export const HEARD_TRADE_NOTICE_CHANCE = 0.15;

/**
 * Los oficios oídos (puro): una entrada por hogar ajeno (`own` se salta), con el oficio por su
 * nombre; si la receta no se conoce, no entra. `whoOf` dice cómo llama a alguien de esa casa.
 */
export function heardTradesOf(
  book: MoldBook | undefined,
  own: string | undefined,
  names: ReadonlyMap<string, string>,
  whoOf: (home: string) => string | undefined,
): HeardTradeView[] {
  const out: HeardTradeView[] = [];
  const seen = new Set<string>();
  const items = [...(book?.items ?? [])].sort((a, b) => b.heardAt - a.heardAt);
  for (const h of items) {
    const r = h.rumor;
    if (r.mold !== "attr" || r.attr !== "trade" || !r.about.startsWith("household:")) continue;
    const home = r.about.slice("household:".length);
    const trade = names.get(String(r.value));
    if (home === own || trade === undefined || seen.has(home)) continue;
    seen.add(home);
    const who = whoOf(home);
    out.push({ trade, sure: h.confidence >= HEARD_TRADE_SURE, ...(who ? { who } : {}) });
  }
  return out;
}

/** Lo que trae a la cabeza este turno: a lo sumo un oficio oído (la tirada es de la vista). */
export function heardTradesForView(
  w: LifeWorld,
  recipes: readonly TradeRecipeDef[],
  rng: Rng,
): readonly HeardTradeView[] {
  const me = w.truth.get(PERSON, w.player);
  const acq = acquaintances(w);
  const names = new Map(recipes.map((r) => [r.id as string, r.name.toLowerCase()]));
  const all = heardTradesOf(w.truth.get(MOLD_RUMORS, w.player), me?.household, names, (home) => {
    for (const [id, a] of [...acq].sort(([x], [y]) => (x < y ? -1 : 1))) {
      if (w.truth.get(PERSON, id as AgentId)?.household === home) return a.name ?? a.relation;
    }
    return undefined;
  });
  if (all.length === 0 || !rng.chance(HEARD_TRADE_NOTICE_CHANCE)) return [];
  return [rng.pick(all)];
}
