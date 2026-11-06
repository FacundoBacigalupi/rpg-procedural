// La bajada anual de la secta (novel-cult-sect-visit, cultivation §3 «medición», organizations): un
// día al año, unos días después del pico de la cosecha, la secta manda gente a la plaza de la aldea a
// buscar chicos con raíz. Una semana antes llega el aviso (`cultivation.sect_herald`): todos los de
// siete años o más lo oyen y quedan creyendo cuándo bajan (`SECT_LORE.visitAt`; el que no sabía de
// la secta ahora la sabe, con su error). El día, de media mañana a la tarde, están en la plaza
// (`cultivation.sect_visit`). Los emisarios todavía no tienen cuerpo (son ranuras de la secta); la
// prueba es `novel-cult-sect-trial`. Solo con el cultivo encendido y una secta con `visitDay`.

import type { AgentId, PlaceRef, PlanetClock } from "../../core/index.ts";
import {
  type EventDraft,
  PERSON,
  type ProcessDef,
  SECT,
  SECT_ANNOUNCE_DAYS,
  SECT_HERALD_EVENT,
  SECT_LORE,
  SECT_VISIT,
  SECT_VISIT_EVENT,
  type StateChange,
  sectLoreOf,
  setComponent,
  upcomingVisit,
} from "../../sim/index.ts";
import { living } from "./living.ts";

export const SECT_VISIT_PROCESS = "life.cultivation.sect_visit";

/** Desde qué edad se entiende y se recuerda el aviso. */
const HEARS_FROM_YEARS = 7;

export function sectVisitProcess(o: {
  readonly clock: PlanetClock;
  readonly lonDeg: number;
  /** La aldea: dónde pasan el aviso y la bajada. */
  readonly village: PlaceRef;
}): ProcessDef {
  const offset = Math.round((o.lonDeg / 360) * o.clock.day);
  return {
    id: SECT_VISIT_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "hour", scene: "hour" },
    representation: "individual",
    phase: "act",
    reads: [SECT.name, SECT_VISIT.name, SECT_LORE.name, PERSON.name],
    writes: [SECT_VISIT.name, SECT_LORE.name],
    run(ctx) {
      const changes: StateChange[] = [];
      const events: EventDraft[] = [];
      for (const org of ctx.truth.ids(SECT)) {
        const sect = ctx.truth.get(SECT, org);
        if (sect?.visitDay === undefined) continue;
        const state = ctx.truth.get(SECT_VISIT, org) ?? { announced: -1, visited: -1 };
        const visit = upcomingVisit(ctx.now, sect.visitDay, o.clock, offset);
        let next = state;
        if (
          state.announced < visit.year &&
          ctx.now >= visit.start - SECT_ANNOUNCE_DAYS * o.clock.day
        ) {
          next = { ...next, announced: visit.year };
          events.push({
            kind: SECT_HERALD_EVENT,
            actors: [],
            place: o.village,
            data: { org, visitAt: visit.start, year: visit.year },
            emissions: {},
            causes: [{ kind: "state", entity: org, key: SECT.name }],
          });
          for (const id of living(ctx.truth) as AgentId[]) {
            const p = ctx.truth.get(PERSON, id);
            if (!p || (ctx.now - p.born) / o.clock.year < HEARS_FROM_YEARS) continue;
            const known =
              ctx.truth.get(SECT_LORE, id) ??
              sectLoreOf(ctx.rng.fork("lore", id), org, sect, ctx.now);
            changes.push(setComponent(SECT_LORE, id, { ...known, visitAt: visit.start }));
          }
        }
        if (state.visited < visit.year && ctx.now >= visit.start && ctx.now < visit.end) {
          next = { ...next, visited: visit.year };
          events.push({
            kind: SECT_VISIT_EVENT,
            actors: [],
            place: o.village,
            data: { org, start: visit.start, until: visit.end, year: visit.year },
            emissions: {},
            causes: [{ kind: "state", entity: org, key: SECT_VISIT.name }],
          });
        }
        if (next !== state) changes.push(setComponent(SECT_VISIT, org, next));
      }
      return changes.length === 0 ? {} : { changes, events };
    },
  };
}
