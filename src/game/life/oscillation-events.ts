// Sequía e inundación de la aldea como eventos propios (planet-gen §3, weather §1). El primer día de
// cada año de la oscilación oceánica, si la fase de la cuenca da en este lugar un año seco
// (`weather.drought`) o húmedo (`weather.flood`), lo deja como evento con su `OscillationCause` en
// `data` y como causa `state` (`oscillation:<cuenca>:<año>:<fase>`, la misma clave que cita la
// hambruna). Sin estado: sale del mapa y el seed. No mueve nada; los dueños del efecto (la lluvia
// del clima y el anegado de `harvestSeason`) ya leen la misma anomalía.

import type { EntityRef, PlaceRef, PlanetClock } from "../../core/index.ts";
import type { OscillationYear, ProcessDef } from "../../sim/index.ts";

export const OSCILLATION_EVENTS_PROCESS = "life.oscillation_events";

export interface OscillationEventsOptions {
  readonly clock: PlanetClock;
  /** `oscillationYearOfMap` del lugar para un día del mundo. */
  readonly yearOf: (day: number) => OscillationYear | undefined;
  /** El lugar del evento y la entidad que lo cita como estado (el asentamiento). */
  readonly place: PlaceRef;
  readonly subject: EntityRef;
}

export function oscillationEventsProcess(o: OscillationEventsOptions): ProcessDef {
  const yearDays = Math.round(o.clock.year / o.clock.day);
  return {
    id: OSCILLATION_EVENTS_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "act",
    reads: [],
    writes: [],
    run(ctx) {
      const today = Math.floor(ctx.now / o.clock.day);
      if (today % yearDays !== 0) return {};
      const y = o.yearOf(today);
      if (y === undefined || y.effect === "none") return {};
      return {
        events: [
          {
            kind: y.effect === "dry" ? "weather.drought" : "weather.flood",
            actors: [],
            place: o.place,
            data: {
              ...y.cause,
              teleconnection: y.teleconnection,
              precipFactor: y.precipFactor,
            },
            emissions: {},
            causes: [
              {
                kind: "state",
                entity: o.subject,
                key: `oscillation:${y.cause.basin}:${y.cause.year}:${y.cause.phase}`,
              },
            ],
          },
        ],
      };
    },
  };
}
