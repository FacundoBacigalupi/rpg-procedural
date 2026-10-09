// El estilo de alguien para la familiaridad (skills §2.3): lo que comparte con su gente, aparte de
// la persona. Por ahora la cultura de su comunidad (la aldea tiene una sola); con varias
// comunidades saldrá de la cultura que cada persona tiene como propia.

import type { AgentId } from "../../core/index.ts";
import { COMMUNITY_CULTURE, type ReadonlyWorldTruth } from "../../sim/index.ts";

/** El id de estilo de `who`, o undefined si no se sabe de qué cultura es. */
export function styleOf(truth: ReadonlyWorldTruth, _who: AgentId): string | undefined {
  const ids = [...truth.ids(COMMUNITY_CULTURE)].sort();
  const first = ids[0];
  return first === undefined ? undefined : truth.get(COMMUNITY_CULTURE, first)?.culture;
}
