// Etapas de vida en la aldea (npc-psychology §10; opt-in `LifeOptions.lifeStages`): al materializar
// cada persona viva recibe su `DevelopmentState` (`life.stages-seeded`, hijo de la fundación); cada
// día el proceso `life.stages` da uno a quien nació después (`life.development-started`, causa su
// nacimiento) y avanza la etapa de quien cruzó el umbral de edad vivida (`life.stage-entered`, el
// «cumpleaños»; sin retroceso). También refresca el apego desde la mente. En la decisión, el sesgo
// de riesgo de la etapa mueve la audacia (`stageBoldness`). Apagado no hay filas, RNG ni eventos.
// Con `rites` (opt-in `stageRites`) el rasgo `rites.coming_of_age` de la cultura abre una ventana
// de edad: con un adulto de padrino se hace el rito (`life.rite-of-passage`, queda en
// `riteOfPassage`); si la ventana vence sin rito queda `riteMissed` (`life.rite-missed`, sin lugar).
// Constantes sin calibrar. Pendiente: apego en la lectura de actos.

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
  dominantVariant,
  draftEvent,
  ENTITY,
  type EventDraft,
  MIND,
  PERSON,
  type ProcessDef,
  type ReadonlyWorldTruth,
  type RiteWindow,
  riteStep,
  type StageDef,
  type StateChange,
  setComponent,
  stageAt,
  stageSocial,
  startDevelopment,
  traitParam,
  villageCulture,
  type WorldTruth,
} from "../../sim/index.ts";

export const STAGES_SEEDED_EVENT = "life.stages-seeded";
export const STAGE_STARTED_EVENT = "life.development-started";
export const STAGE_ENTERED_EVENT = "life.stage-entered";
export const RITE_HELD_EVENT = "life.rite-of-passage";
export const RITE_MISSED_EVENT = "life.rite-missed";
export const STAGES_PROCESS = "life.stages";

/** El rasgo de la cultura que marca el paso a la vida adulta (culture, ritos de paso). */
export const COMING_OF_AGE_TRAIT = "rites.coming_of_age";
/** Edad del rito si la variante de la cultura no la dice (sin calibrar). */
export const COMING_OF_AGE_DEFAULT_YEARS = 15;
/** Años que queda abierta la ventana del rito después de la edad (sin calibrar). */
export const RITE_GRACE_YEARS = 2;
/** Días tras vencer la ventana en que se registra que el rito se perdió (una sola vez por la marca). */
export const RITE_MISS_DAYS = 7;
/** Edad desde la que alguien puede apadrinar un rito si la tabla de etapas no tiene `adult`. */
const SPONSOR_FALLBACK_AGE = 30;

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
  /** Opt-in (`LifeOptions.stageRites`): el rito de paso que marca la cultura de la aldea. */
  readonly rites?: { readonly graceYears?: number };
}

interface ActiveRite {
  readonly window: RiteWindow;
  readonly variant: string;
  readonly stage: string;
  readonly missYears: number;
}

/** El rito de paso de la cultura de la aldea, o `undefined` si no tiene ese rasgo. */
function riteOf(truth: ReadonlyWorldTruth, o: StagesProcessOptions): ActiveRite | undefined {
  const culture = villageCulture(truth);
  const variant = dominantVariant(culture, COMING_OF_AGE_TRAIT);
  if (variant === undefined) return undefined;
  const ageYears = traitParam(
    culture,
    COMING_OF_AGE_TRAIT,
    "ageYears",
    COMING_OF_AGE_DEFAULT_YEARS,
  );
  return {
    window: { ageYears, graceYears: o.rites?.graceYears ?? RITE_GRACE_YEARS },
    variant,
    stage: stageAt(o.stages, ageYears).id,
    missYears: (RITE_MISS_DAYS * o.clock.day) / o.clock.year,
  };
}

/** Los vivos con edad de apadrinar un rito, en orden de id. */
function sponsorsOf(
  truth: ReadonlyWorldTruth,
  people: readonly AgentId[],
  o: StagesProcessOptions,
  now: Tick,
): AgentId[] {
  const from = o.stages.find((s) => s.id === "adult")?.fromAge ?? SPONSOR_FALLBACK_AGE;
  return people.filter((p) => (now - (truth.get(PERSON, p)?.born ?? now)) / o.clock.year >= from);
}

/** Un día de desarrollo: estados nuevos, cambios de etapa por edad vivida, apego y ritos de paso. */
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
      const people = aliveIds(ctx.truth);
      const rite = o.rites ? riteOf(ctx.truth, o) : undefined;
      const sponsors = rite ? sponsorsOf(ctx.truth, people, o, ctx.now) : [];
      // Padrino del rito: el adulto vivo de menor id que no es el propio iniciado.
      const sponsorFor = (who: AgentId): AgentId | undefined => sponsors.find((s) => s !== who);
      for (const p of people) {
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
        let cur: DevelopmentState = state;
        if (moved.transition) {
          cur = { ...moved.state, attachment };
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
          cur = { ...state, attachment };
        }
        if (rite) {
          const sponsor = sponsorFor(p);
          const step = riteStep(cur, rite.window, age, sponsor !== undefined, rite.missYears);
          if (step === "hold" && sponsor !== undefined) {
            events.push({
              kind: RITE_HELD_EVENT,
              actors: [p, sponsor],
              place: o.placeOf(ctx.truth, p),
              data: { rite: rite.variant, stage: rite.stage, ageYears: Math.floor(age) },
              emissions: { sight: 0.3 },
              causes: [{ kind: "event", event: state.originEventId }],
            });
            cur = { ...cur, riteOfPassage: draftEvent(events.length - 1) };
          } else if (step === "miss") {
            events.push({
              kind: RITE_MISSED_EVENT,
              actors: [p],
              place: o.placeOf(ctx.truth, p),
              data: { rite: rite.variant, stage: rite.stage, ageYears: Math.floor(age) },
              emissions: {},
              causes: [{ kind: "event", event: state.originEventId }],
            });
            cur = { ...cur, riteMissed: true };
          }
        }
        if (cur !== state) changes.push(setComponent(DEVELOPMENT, p, cur));
      }
      return changes.length > 0 || events.length > 0 ? { changes, events } : {};
    },
  };
}
