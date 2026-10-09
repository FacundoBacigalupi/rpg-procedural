// El estilo de alguien para la familiaridad (skills §2.3): lo que comparte con su gente, aparte de
// la persona. Es la cultura de la comunidad a la que se siente de pertenecer (`ownGroup`: su
// identidad guardada o donde mejor cuadra lo que sostiene); con una sola comunidad es esa, sin
// mirar a la persona.

import type { AgentId } from "../../core/index.ts";
import { COMMUNITY_CULTURE, type ReadonlyWorldTruth } from "../../sim/index.ts";
import { ownGroup } from "./identity.ts";

/** El id de estilo de `who`, o undefined si no se sabe de qué cultura es. */
export function styleOf(truth: ReadonlyWorldTruth, who: AgentId): string | undefined {
  const ids = [...truth.ids(COMMUNITY_CULTURE)].sort();
  const first = ids[0];
  if (first === undefined) return undefined;
  if (ids.length === 1) return truth.get(COMMUNITY_CULTURE, first)?.culture;
  return ownGroup(truth, who) ?? truth.get(COMMUNITY_CULTURE, first)?.culture;
}
