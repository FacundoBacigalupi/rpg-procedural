// El entorno de las señales de ansia como lo vive el personaje (opt-in): las personas que CREE
// presentes (sus creencias, no la verdad) y el huso local por la longitud del lugar.

import type { AgentId, PlanetClock, Tick } from "../../core/index.ts";
import { BELIEFS, LOCATION, type ReadonlyWorldTruth } from "../../sim/index.ts";
import { whereaboutsFromBeliefs } from "./known.ts";

export interface CueLocal {
  readonly believedPresent: readonly string[];
  readonly hourOffset: number;
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
    if (whereaboutsFromBeliefs(beliefs, id, here, now).present) believedPresent.push(id);
  }
  believedPresent.sort();
  return { believedPresent, hourOffset: Math.round(lonDeg / 15) };
}
