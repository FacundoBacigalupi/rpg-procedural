// Etapas de vida en la aldea (npc-psychology §10; opt-in `LifeOptions.lifeStages`): al materializar
// cada persona viva recibe su `DevelopmentState` (`life.stages-seeded`, hijo de la fundación); cada
// día el proceso `life.stages` da uno a quien nació después (`life.development-started`, causa su
// nacimiento) y avanza la etapa de quien cruzó el umbral de edad vivida (`life.stage-entered`, el
// «cumpleaños»; sin retroceso). También refresca el apego desde la mente. En la decisión, el sesgo
// de riesgo de la etapa mueve la audacia (`stageBoldness`). Apagado no hay filas, RNG ni eventos.
// Constantes sin calibrar. Pendiente: ritos de paso desde la cultura, apego en la lectura de actos.

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
  advanceStage,
  attachmentFromMind,
  DEVELOPMENT,
  type DevelopmentState,
  draftEvent,
  ENTITY,
  type EventDraft,
  MIND,
  PERSON,
  type ProcessDef,
  type ReadonlyWorldTruth,
  type StageDef,
  type StateChange,
  setComponent,
  stageSocial,
  startDevelopment,
  type WorldTruth,
} from "../../sim/index.ts";

export const STAGES_SEEDED_EVENT = "life.stages-seeded";
export const STAGE_STARTED_EVENT = "life.development-started";
export const STAGE_ENTERED_EVENT = "life.stage-entered";
export const STAGES_PROCESS = "life.stages";

/** Cuánto mueve el `riskBias` de la etapa a la audacia de la decisión (sin calibrar). */
export const STAGE_BOLDNESS_GAIN = 0.4;

/** La audacia de la decisión con el sesgo de riesgo de la etapa, acotada a 0-1. */
export function stageBoldness(boldness: number, stage: string): number {
  return Math.min(1, Math.max(0, boldness + STAGE_BOLDNESS_GAIN * stageSocial(stage).riskBias));
}

const aliveIds = (truth: ReadonlyWorldTruth): AgentId[] =>
  truth
    .ids(PERSON)
    .map((p) => p as AgentId)
    .filter((p) => truth.get(ENTITY, p)?.endedAt === undefined)
    .sort(compareStrings);

export interface SeedStagesOptions {
  readonly stages: readonly StageDef[];
  readonly clock: PlanetClock;
  readonly now: Tick;
  readonly place: PlaceRef;
  readonly foundersEvent: EventId;
}

/** Da su estado de desarrollo a cada persona viva; devuelve cuántos dejó. */
export function seedDevelopment(
  truth: WorldTruth,
  ids: IdAllocator,
  log: EventLog,
  o: SeedStagesOptions,
): number {
  const people = aliveIds(truth);
  if (people.length === 0 || o.stages.length === 0) return 0;
  const event = ids.next("event");
  log.append({
    id: event,
    tick: o.now,
    kind: STAGES_SEEDED_EVENT,
    actors: [],
    place: o.place,
    data: { people: people.length },
    emissions: {},
    causes: [{ kind: "event", event: o.foundersEvent }],
    resolution: "local",
  });
  for (const p of people) {
    const age = (o.now - (truth.get(PERSON, p)?.born ?? o.now)) / o.clock.year;
    const mind = truth.get(MIND, p) ?? { schemas: {} };
    truth.set(DEVELOPMENT, p, startDevelopment(o.stages, age, o.now, mind, event));
  }
  return people.length;
}

export interface StagesProcessOptions {
  readonly stages: readonly StageDef[];
  readonly clock: PlanetClock;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

/** Un día de desarrollo: estados nuevos, cambios de etapa por edad vivida y apego al día. */
export function stagesProcess(o: StagesProcessOptions): ProcessDef {
  return {
    id: STAGES_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "settle",
    reads: [DEVELOPMENT.name, MIND.name, PERSON.name, ENTITY.name],
    writes: [DEVELOPMENT.name],
    run(ctx) {
      const events: EventDraft[] = [];
      const changes: StateChange[] = [];
      for (const p of aliveIds(ctx.truth)) {
        const person = ctx.truth.get(PERSON, p);
        if (!person) continue;
        const age = (ctx.now - person.born) / o.clock.year;
        const mind = ctx.truth.get(MIND, p) ?? { schemas: {} };
        const state: DevelopmentState | undefined = ctx.truth.get(DEVELOPMENT, p);
        if (!state) {
          const birth = ctx.truth.get(ENTITY, p)?.originEventId;
          if (!birth) continue;
          const started = startDevelopment(o.stages, age, ctx.now, mind, draftEvent(events.length));
          changes.push(setComponent(DEVELOPMENT, p, started));
          events.push({
            kind: STAGE_STARTED_EVENT,
            actors: [p],
            place: o.placeOf(ctx.truth, p),
            data: { stage: started.stage, attachment: started.attachment },
            emissions: {},
            causes: [{ kind: "event", event: birth }],
          });
          continue;
        }
        const moved = advanceStage(state, o.stages, age, ctx.now, draftEvent(events.length));
        const attachment = attachmentFromMind(mind);
        if (moved.transition) {
          changes.push(setComponent(DEVELOPMENT, p, { ...moved.state, attachment }));
          events.push({
            kind: STAGE_ENTERED_EVENT,
            actors: [p],
            place: o.placeOf(ctx.truth, p),
            data: {
              from: moved.transition.from,
              to: moved.transition.to,
              ageYears: Math.floor(age),
            },
            emissions: { sight: 0.1 },
            causes: [{ kind: "event", event: state.originEventId }],
          });
        } else if (attachment !== state.attachment) {
          changes.push(setComponent(DEVELOPMENT, p, { ...state, attachment }));
        }
      }
      return changes.length > 0 || events.length > 0 ? { changes, events } : {};
    },
  };
}
