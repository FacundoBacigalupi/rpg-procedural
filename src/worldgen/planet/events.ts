// Los hechos de la generación (causality §1): todo lo que planet-gen pone en el mundo cita el
// evento que lo causó. Son `Event` de core comunes (tick 0, resolución "history"), así que entran
// tal cual al registro de la vida y el inspector puede preguntar `why` por un volcán o una veta.

import {
  type CauseRef,
  type Event,
  type EventId,
  makeId,
  type PlaceRef,
} from "../../core/index.ts";

export class PlanetEvents {
  readonly list: Event[];

  /** Sigue la numeración de `before` (los eventos del planeta, para lo que se genera después). */
  constructor(before: readonly Event[] = []) {
    this.list = [...before];
  }

  add(kind: string, place: PlaceRef, causes: readonly CauseRef[], data: unknown = {}): EventId {
    const id = makeId("event", this.list.length + 1);
    this.list.push({
      id,
      tick: 0,
      kind,
      actors: [],
      place,
      data,
      emissions: null,
      causes: [...causes],
      resolution: "history",
    });
    return id;
  }
}

export function because(...events: EventId[]): CauseRef[] {
  return events.map((event) => ({ kind: "event", event }));
}

/** Número de un id de evento, para guardarlo en arreglos tipados (0 es "ninguno"). */
export function eventNumber(id: EventId): number {
  return Number(id.slice(6));
}
