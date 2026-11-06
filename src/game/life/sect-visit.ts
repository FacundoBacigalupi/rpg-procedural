// La bajada anual de la secta (novel-cult-sect-visit, cultivation §3 «medición», organizations): un
// día al año, unos días después del pico de la cosecha, la secta manda gente a la plaza de la aldea a
// buscar chicos con raíz. Una semana antes llega el aviso (`cultivation.sect_herald`): todos los de
// siete años o más lo oyen y quedan creyendo cuándo bajan (`SECT_LORE.visitAt`; el que no sabía de
// la secta ahora la sabe, con su error). El día, de media mañana a la tarde, están en la plaza
// (`cultivation.sect_visit`). Los emisarios todavía no tienen cuerpo (son ranuras de la secta); la
// prueba es `novel-cult-sect-trial`. Solo con el cultivo encendido y una secta con `visitDay`.
//
// La prueba (novel-cult-sect-trial): mientras están en la plaza miden a los de 8 a 16 años con la
// piedra (`readRoots`: la raíz con el error del instrumento). Los que están en la plaza (el
// personaje si fue, cualquiera que pase) se miden en la hora que estén; a los demás chicos los lleva
// su casa o no (`TRIAL_BROUGHT_CHANCE`, una tirada por chico y año) y se miden al llegar la secta.
// Cada uno una vez por año: `SECT_TRIAL` guarda la última lectura, que el medido cree;
// `cultivation.sect_trial` la deja, causada por la bajada y por el talento.

import type { AgentId, PlaceRef, PlanetClock } from "../../core/index.ts";
import {
  CULTIVATION_LAW,
  type EventDraft,
  LOCATION,
  PERSON,
  type ProcessDef,
  readRoots,
  SECT,
  SECT_ANNOUNCE_DAYS,
  SECT_HERALD_EVENT,
  SECT_LORE,
  SECT_TRIAL,
  SECT_TRIAL_EVENT,
  SECT_VISIT,
  SECT_VISIT_EVENT,
  type StateChange,
  sectLoreOf,
  setComponent,
  TALENT,
  TRIAL_BROUGHT_CHANCE,
  TRIAL_MAX_YEARS,
  TRIAL_MIN_YEARS,
  trialAccepts,
  upcomingVisit,
  VILLAGE_SQUARE,
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
  /** El personaje: va a la plaza o no por su cuenta, nadie lo lleva. */
  readonly player?: AgentId;
}): ProcessDef {
  const offset = Math.round((o.lonDeg / 360) * o.clock.day);
  return {
    id: SECT_VISIT_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "hour", scene: "hour" },
    representation: "individual",
    phase: "act",
    reads: [
      SECT.name,
      SECT_VISIT.name,
      SECT_LORE.name,
      PERSON.name,
      CULTIVATION_LAW.name,
      TALENT.name,
      LOCATION.name,
      SECT_TRIAL.name,
    ],
    writes: [SECT_VISIT.name, SECT_LORE.name, SECT_TRIAL.name],
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
        const inWindow = ctx.now >= visit.start && ctx.now < visit.end;
        const arriving = inWindow && state.visited < visit.year;
        if (arriving) {
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
        const plane = ctx.truth.ids(CULTIVATION_LAW)[0];
        const law = inWindow && plane ? ctx.truth.get(CULTIVATION_LAW, plane) : undefined;
        if (law) {
          for (const id of living(ctx.truth) as AgentId[]) {
            const p = ctx.truth.get(PERSON, id);
            const talent = ctx.truth.get(TALENT, id);
            if (!p || !talent) continue;
            const age = (ctx.now - p.born) / o.clock.year;
            if (age < TRIAL_MIN_YEARS || age >= TRIAL_MAX_YEARS) continue;
            if ((ctx.truth.get(SECT_TRIAL, id)?.year ?? -1) >= visit.year) continue;
            const atSquare = ctx.truth.get(LOCATION, id)?.space === VILLAGE_SQUARE;
            const brought =
              arriving &&
              id !== o.player &&
              ctx.rng.fork("brought", id, visit.year).chance(TRIAL_BROUGHT_CHANCE);
            if (!atSquare && !brought) continue;
            const reading = readRoots(law, talent.innate, ctx.rng.fork("trial", id, visit.year));
            const accepted = trialAccepts(reading);
            changes.push(
              setComponent(SECT_TRIAL, id, {
                org,
                year: visit.year,
                at: ctx.now,
                reading,
                accepted,
              }),
            );
            events.push({
              kind: SECT_TRIAL_EVENT,
              actors: [id],
              place: o.village,
              data: { org, year: visit.year, accepted, ...reading },
              emissions: { sight: 0.3 },
              causes: [
                { kind: "state", entity: org, key: SECT_VISIT.name },
                { kind: "state", entity: id, key: TALENT.name },
              ],
            });
          }
        }
        if (next !== state) changes.push(setComponent(SECT_VISIT, org, next));
      }
      return changes.length === 0 ? {} : { changes, events };
    },
  };
}
