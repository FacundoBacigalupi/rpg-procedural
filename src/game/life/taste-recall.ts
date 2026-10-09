// El recuerdo atado a un gusto (npc-psychology §16): si el gusto nació de un evento que el personaje
// todavía recuerda, cómo lo recuerda. Lo usan la vista (`tastesForView`) y los pensamientos
// (`thoughtsOf`); vive aparte para que `view.ts` y `thoughts.ts` no se importen entre sí.

import type { EventId } from "../../core/index.ts";
import type { Memory } from "../../sim/index.ts";

/** Desde cuánto pesa una memoria (valencia) para que el gusto se cuente atado a ella. */
export const TASTE_RECALL_VALENCE = 0.3;

/**
 * Si el gusto nació de un evento que el personaje todavía recuerda (la intoxicación, el festín),
 * cómo lo recuerda: mal o bien, según la valencia de su memoria. Sin esa memoria, nada.
 */
export function tasteRecall(
  items: readonly Pick<Memory, "eventId" | "valence" | "intensity">[],
  origins: readonly EventId[],
): "ill" | "good" | undefined {
  if (origins.length === 0) return undefined;
  const mine = items
    .filter((m) => origins.includes(m.eventId) && Math.abs(m.valence) >= TASTE_RECALL_VALENCE)
    .sort((a, b) => b.intensity - a.intensity)[0];
  return mine === undefined ? undefined : mine.valence < 0 ? "ill" : "good";
}
