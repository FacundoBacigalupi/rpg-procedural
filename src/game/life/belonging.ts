// Pertenencia en la aldea (npc-psychology §13; opt-in `LifeOptions.belonging`): cada persona viva
// guarda su `BelongingState` (`life.belonging-seeded`, hijo de la fundación); el proceso diario
// `life.belonging` da estado a quien nació después, mueve el nivel despacio hacia lo que la casa,
// los padres, la pareja y la aldea sostienen, y deja un evento (`life.belonging-deficit`, con la
// causa) cuando el déficit pasa de alto y otro (`life.belonging-restored`) cuando se recupera.
// Apagado no hay filas, RNG ni eventos. Hoy no la lee la utilidad ni el panel (declarada).

import {
  type AgentId,
  compareStrings,
  type EventId,
  type EventLog,
  type IdAllocator,
  type PlaceRef,
  type PlanetClock,
  type Tick,
} from "../../core/index.ts";
import {
  BELONGING,
  type BelongingInputs,
  type BelongingState,
  belongingSources,
  belongingTarget,
  ENTITY,
  type EventDraft,
  nextInDeficit,
  PERSON,
  type ProcessDef,
  type ReadonlyWorldTruth,
  type StateChange,
  setComponent,
  stepBelonging,
  type WorldTruth,
} from "../../sim/index.ts";

export const BELONGING_SEEDED_EVENT = "life.belonging-seeded";
export const BELONGING_STARTED_EVENT = "life.belonging-started";
export const BELONGING_DEFICIT_EVENT = "life.belonging-deficit";
export const BELONGING_RESTORED_EVENT = "life.belonging-restored";
export const BELONGING_PROCESS = "life.belonging";

const aliveIds = (truth: ReadonlyWorldTruth): AgentId[] =>
  truth
    .ids(PERSON)
    .map((p) => p as AgentId)
    .filter((p) => truth.get(ENTITY, p)?.endedAt === undefined)
    .sort(compareStrings);

const isAlive = (truth: ReadonlyWorldTruth, id: AgentId | null): boolean =>
  id !== null &&
  truth.get(ENTITY, id) !== undefined &&
  truth.get(ENTITY, id)?.endedAt === undefined;

/** Lo que `me` tiene alrededor hoy, leído de la verdad (casa, padres, pareja, años en la aldea). */
export function belongingInputsOf(
  truth: ReadonlyWorldTruth,
  me: AgentId,
  now: Tick,
  clock: PlanetClock,
): BelongingInputs | undefined {
  const person = truth.get(PERSON, me);
  if (!person) return undefined;
  let housemates = 0;
  for (const id of truth.ids(PERSON)) {
    if (id === me) continue;
    if (truth.get(PERSON, id)?.household !== person.household) continue;
    if (truth.get(ENTITY, id)?.endedAt !== undefined) continue;
    housemates++;
  }
  const since = truth.get(ENTITY, me)?.createdAt ?? now;
  return {
    housemates,
    spouseAlive: isAlive(truth, person.spouse),
    parentsAlive: (isAlive(truth, person.mother) ? 1 : 0) + (isAlive(truth, person.father) ? 1 : 0),
    ageYears: (now - person.born) / clock.year,
    yearsInVillage: Math.max(0, now - since) / clock.year,
  };
}

function freshState(
  truth: ReadonlyWorldTruth,
  me: AgentId,
  now: Tick,
  clock: PlanetClock,
  origin: EventId,
): BelongingState | undefined {
  const inputs = belongingInputsOf(truth, me, now, clock);
  if (!inputs) return undefined;
  const { sources, reasons } = belongingSources(inputs);
  const level = belongingTarget(sources);
  return {
    level,
    sources,
    reasons,
    inDeficit: nextInDeficit(false, level),
    updatedAt: now,
    originEventId: origin,
  };
}

export interface SeedBelongingOptions {
  readonly clock: PlanetClock;
  readonly now: Tick;
  readonly place: PlaceRef;
  readonly foundersEvent: EventId;
}

/** Da su pertenencia inicial (ya asentada en lo que la rodea) a cada persona viva; devuelve cuántas. */
export function seedBelonging(
  truth: WorldTruth,
  ids: IdAllocator,
  log: EventLog,
  o: SeedBelongingOptions,
): number {
  const people = aliveIds(truth);
  if (people.length === 0) return 0;
  const event = ids.next("event");
  log.append({
    id: event,
    tick: o.now,
    kind: BELONGING_SEEDED_EVENT,
    actors: [],
    place: o.place,
    data: { people: people.length },
    emissions: {},
    causes: [{ kind: "event", event: o.foundersEvent }],
    resolution: "local",
  });
  for (const p of people) {
    const s = freshState(truth, p, o.now, o.clock, event);
    if (s) truth.set(BELONGING, p, s);
  }
  return people.length;
}

export interface BelongingProcessOptions {
  readonly clock: PlanetClock;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

/** Un día de pertenencia: estados nuevos, el nivel hacia su objetivo y los avisos de déficit. */
export function belongingProcess(o: BelongingProcessOptions): ProcessDef {
  return {
    id: BELONGING_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "settle",
    reads: [BELONGING.name, PERSON.name, ENTITY.name],
    writes: [BELONGING.name],
    run(ctx) {
      const events: EventDraft[] = [];
      const changes: StateChange[] = [];
      for (const p of aliveIds(ctx.truth)) {
        const state = ctx.truth.get(BELONGING, p);
        if (!state) {
          const birth = ctx.truth.get(ENTITY, p)?.originEventId;
          if (!birth) continue;
          const started = freshState(ctx.truth, p, ctx.now, o.clock, birth);
          if (!started) continue;
          changes.push(setComponent(BELONGING, p, started));
          events.push({
            kind: BELONGING_STARTED_EVENT,
            actors: [p],
            place: o.placeOf(ctx.truth, p),
            data: { level: started.level },
            emissions: {},
            causes: [{ kind: "event", event: birth }],
          });
          continue;
        }
        const inputs = belongingInputsOf(ctx.truth, p, ctx.now, o.clock);
        if (!inputs) continue;
        const { sources, reasons } = belongingSources(inputs);
        const days = Math.max(0, ctx.now - state.updatedAt) / o.clock.day;
        const level = stepBelonging(state.level, belongingTarget(sources), days);
        const inDeficit = nextInDeficit(state.inDeficit, level);
        const next = { ...state, level, sources, reasons, inDeficit, updatedAt: ctx.now };
        const same =
          level === state.level &&
          inDeficit === state.inDeficit &&
          JSON.stringify(sources) === JSON.stringify(state.sources) &&
          JSON.stringify(reasons) === JSON.stringify(state.reasons);
        if (!same) changes.push(setComponent(BELONGING, p, next));
        if (inDeficit !== state.inDeficit) {
          events.push({
            kind: inDeficit ? BELONGING_DEFICIT_EVENT : BELONGING_RESTORED_EVENT,
            actors: [p],
            place: o.placeOf(ctx.truth, p),
            data: { level, reasons: [...reasons] },
            emissions: {},
            causes: [{ kind: "event", event: state.originEventId }],
          });
        }
      }
      return changes.length > 0 || events.length > 0 ? { changes, events } : {};
    },
  };
}
