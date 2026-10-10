// El entorno de las señales de ansia como lo vive el personaje (opt-in): las personas que CREE
// presentes (sus creencias, no la verdad) y el huso local por la longitud del lugar.

import type { AgentId, PlanetClock, Tick } from "../../core/index.ts";
import {
  BELIEFS,
  type Beliefs,
  beliefConfidenceAt,
  believed,
  LOCATION,
  type ReadonlyWorldTruth,
} from "../../sim/index.ts";

// Mismo umbral que `RECOGNIZED_CONFIDENCE` de view.ts (no se importa: view -> world cierra un ciclo
// con decide).
const PRESENT_CONFIDENCE = 0.2;

type Here = { readonly hex: unknown; readonly space?: unknown } | undefined;

function believesPresent(
  beliefs: Beliefs | undefined,
  id: AgentId,
  here: Here,
  now: Tick,
): boolean {
  const b = believed(beliefs, id, "at");
  if (b === undefined || typeof b.value === "boolean" || typeof b.value === "string") return false;
  if (beliefConfidenceAt(b, now) < PRESENT_CONFIDENCE || !here) return false;
  return b.value.hex === here.hex && b.value.space === here.space;
}

export interface CueLocal {
  readonly believedPresent: readonly string[];
  readonly hourOffset: number;
}

/**
 * Los objetos a la vista (puro): de los bienes que remiten a una sustancia, los que cree tener a
 * mano (`have` >= 1 en lo que ve o lleva). Ver el objeto despierta la señal por objeto (`obj:<bien>`).
 */
export function objectsSeen(
  goods: readonly string[],
  have: (good: string) => number,
): readonly string[] {
  return [...new Set(goods)].filter((g) => have(g) >= 1).sort();
}

export function cueLocalOf(
  truth: ReadonlyWorldTruth,
  who: AgentId,
  now: Tick,
  _clock: PlanetClock,
  lonDeg: number,
): CueLocal {
  const beliefs = truth.get(BELIEFS, who);
  const here = truth.get(LOCATION, who);
  const subjects = new Set<AgentId>();
  for (const b of beliefs?.items ?? []) if (b.prop.attr === "at") subjects.add(b.prop.subject);
  const believedPresent: string[] = [];
  for (const id of subjects) {
    if (id === who) continue;
    if (believesPresent(beliefs, id, here, now)) believedPresent.push(id);
  }
  believedPresent.sort();
  return { believedPresent, hourOffset: Math.round(lonDeg / 15) };
}
