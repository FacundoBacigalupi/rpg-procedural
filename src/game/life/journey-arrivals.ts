// Epidemias que viajan (body-health §6, travel.md): el viajero que sale de un origen con una
// epidemia (otra aldea, un campamento) lleva el patógeno consigo. Provee `ExposureOptions.arrivals`
// desde los viajes abiertos (`NPC_JOURNEY`): quien partió ayer de un origen afligido es un
// `Carrier` más, con la tirada con clave de `arrivalSeed`; el contagio local lo hace `life.exposure`
// por lugar y hogar. Opt-in: sin orígenes afligidos no hay semillas, RNG ni eventos.

import type { AgentId, CauseRef, PlanetClock, Rng, Tick } from "../../core/index.ts";
import type { Carrier, PathogenDef, ReadonlyWorldTruth, Shared } from "../../sim/index.ts";
import { arrivalSeed, type PathogenSeed } from "./exposure.ts";
import { NPC_JOURNEY } from "./npc-verbs.ts";

/** Un origen con una epidemia en curso: de ahí salen los viajeros con el patógeno encima. */
export interface AfflictedOrigin {
  /** El hex del que parten (`NpcJourney.from`). */
  readonly hex: number;
  readonly def: PathogenDef;
  /** Desde cuándo hay epidemia allí (antes no se lleva nada). */
  readonly since: Tick;
  /** Evento que la causó o la registró en el origen (causa de la llegada). */
  readonly cause: CauseRef;
  /** Horas que llevan expuestos los que parten (default 24: incubando). */
  readonly hoursSinceExposure?: number;
  /** Etiqueta del origen para la ficha del patógeno. */
  readonly label?: string;
}

/** Lo que el viajero deja a su paso en un día (cercanía alta: pasa la jornada entre otros). */
const ON_ROAD_DAY: Shared = {
  hours: 8,
  closeness: 0.5,
  ventilation: 0.6,
  waterDirt: 0,
  touch: 0.3,
};

/**
 * Semillas del día (pura salvo la tirada con clave): cada viajero que salió de un origen afligido en
 * las últimas 24 h, con la epidemia ya vigente al partir, es un portador; `perCarrier` evita
 * resembrar al que ya la tiene. Orden estable por id; sin viajes ni orígenes, vacío.
 */
export function journeySeeds(
  rng: Rng,
  truth: ReadonlyWorldTruth,
  now: Tick,
  clock: PlanetClock,
  origins: readonly AfflictedOrigin[],
): PathogenSeed[] {
  if (origins.length === 0) return [];
  const out: PathogenSeed[] = [];
  for (const id of [...truth.ids(NPC_JOURNEY)].sort()) {
    const trip = truth.get(NPC_JOURNEY, id as AgentId);
    if (!trip || trip.from === undefined) continue;
    if (now - trip.since >= clock.day || now < trip.since) continue;
    const origin = origins.find((o) => o.hex === trip.from && o.since <= trip.since);
    if (!origin) continue;
    const carrier: Carrier = {
      pathogen: origin.def,
      hoursSinceExposure: origin.hoursSinceExposure ?? 24,
      fatal: false,
      from: origin.label ?? `el hex ${origin.hex}`,
      party: 1,
    };
    const hours = (now - trip.since) / (clock.day / 24);
    const seed = arrivalSeed(rng.fork("journey", now), carrier, hours, ON_ROAD_DAY, {
      carrier: id as AgentId,
      from: now,
      event: origin.cause,
    });
    if (seed)
      out.push({ ...seed, source: `salió de ${carrier.from} con la epidemia`, perCarrier: true });
  }
  return out;
}
