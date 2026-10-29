// El tiro del ganado (livestock-yield-draft): el buey adulto del hogar tira del arado y la hora de
// campo rinde más (`DraftDef.fieldRate`). Cada animal sirve a `workers` personas a la vez; con más
// gente en edad de trabajar que puestos, la ganancia se reparte entre todos (se turnan el arado), así
// que la casa no gana más que lo que el animal da. Uno con mucha hambre no tira.
// Lo que el tiro le cuesta al animal: más comida los días de campo (livestock-draft-cost, en el
// proceso de comer) y, con `fatigue` (livestock-draft-fatigue), el cansancio de `DRAFT_FATIGUE`: el
// cansado da menos y el que ya tiró `maxHoursPerDay` en el día no tira; `use` dice cuántas horas de
// cada animal se lleva esta hora de campo, para que la rutina las sume.

import {
  type AgentId,
  type AnimalId,
  type Duration,
  type HolderRef,
  holderAccount,
  type Tick,
} from "../../core/index.ts";
import {
  ANIMAL,
  ANIMAL_HUNGER,
  DAILY_KCAL,
  DRAFT_FATIGUE,
  type DraftDef,
  draftFatigueFactor,
  draftRestThreshold,
  ENTITY,
  HARVEST_GOOD,
  INNATE,
  type LivestockDef,
  PERSON,
  type ReadonlyLedger,
  type ReadonlyWorldTruth,
} from "../../sim/index.ts";
import { INVENTORY_BELIEF } from "./inventory-belief.ts";

/** Las calorías por gramo del grano de la despensa (el cereal del catálogo, ~3.5). */
const GRAIN_KCAL_PER_GRAM = 3.5;

/** Las tablas que lee `draftFor` (para declararlas en el proceso). */
export const DRAFT_READS = [
  ANIMAL.name,
  ANIMAL_HUNGER.name,
  PERSON.name,
  ENTITY.name,
  DRAFT_FATIGUE.name,
  INNATE.name,
] as const;

/** Las tablas que lee `draftFor` con estas opciones (con `restBelief`, también lo que cree tener). */
export function draftReads(o: DraftOptions): readonly string[] {
  return o.restBelief === true ? [...DRAFT_READS, INVENTORY_BELIEF.name] : DRAFT_READS;
}

/** Las especies que tiran, por id (las que tienen `draft`). */
export function draftDefsOf(species: readonly LivestockDef[]): ReadonlyMap<string, DraftDef> {
  return new Map(species.flatMap((s) => (s.draft === undefined ? [] : [[s.id, s.draft] as const])));
}

export interface DraftOptions {
  readonly defs: ReadonlyMap<string, DraftDef>;
  /** Duración del año (ticks). */
  readonly year: Duration;
  /** Desde qué edad (años) trabaja la gente en el campo. */
  readonly workAge: number;
  /** Opt-in (livestock-draft-fatigue): el cansancio de `DRAFT_FATIGUE` baja el tiro. */
  readonly fatigue?: boolean;
  /** Opt-in (livestock-draft-rest, con `fatigue`): el hogar descansa al cansado en vez de seguir. */
  readonly rest?: boolean;
  /**
   * Opt-in (livestock-draft-rest-choice, con `rest`): el umbral de descanso sale de la calidez de
   * quien trabaja (`draftRestThreshold`), no del fijo de la especie: cada uno decide en su turno.
   */
  readonly restChoice?: boolean;
  /**
   * Opt-in (livestock-draft-rest-press, con `restChoice`): el grano de la despensa que no llega a
   * `PRESS_DAYS` días de la casa sube el umbral (`larderPress`): con hambre cerca, se sigue arando.
   * Necesita el ledger.
   */
  readonly restPress?: boolean;
  /**
   * Opt-in (livestock-draft-rest-belief, con `restPress`): el grano que cuenta es el que cree tener
   * quien decide (`INVENTORY_BELIEF.larder`, la última vez que revisó la despensa); sin foto, el saldo.
   */
  readonly restBelief?: boolean;
  /**
   * Opt-in (livestock-draft-rest-season, con `restChoice`): el rinde del campo de hoy contra el de
   * los próximos `SEASON_AHEAD_DAYS` (`seasonPress`): si la temporada se termina, se sigue arando.
   * `dayAt` da el día del campo (con la hora local) de un tick.
   */
  readonly restSeason?: {
    readonly season: (day: number) => number;
    readonly dayAt: (now: Tick) => number;
  };
}

/** Cuántos días adelante mira el que decide si la temporada se le va. */
export const SEASON_AHEAD_DAYS = 14;

/**
 * Pura: el apuro (0-1) de la temporada: lo que rinde hoy el campo contra el promedio de los
 * próximos `SEASON_AHEAD_DAYS` días (`1 − adelante / hoy`). Hoy sin rinde, o lo que viene igual o
 * mejor, 0.
 */
export function seasonPress(season: (day: number) => number, day: number): number {
  const today = season(day);
  if (today <= 0) return 0;
  let ahead = 0;
  for (let d = 1; d <= SEASON_AHEAD_DAYS; d++) ahead += season(day + d);
  return Math.min(1, Math.max(0, 1 - ahead / SEASON_AHEAD_DAYS / today));
}

/** Con cuántos días de grano en la despensa la casa ya no se apura. */
export const PRESS_DAYS = 60;

/** Pura: el apuro (0-1) de una casa de `mouths` bocas con `grams` de grano: 1 sin nada, 0 desde `PRESS_DAYS`. */
export function larderPress(grams: number, mouths: number): number {
  const days = (grams * GRAIN_KCAL_PER_GRAM) / (DAILY_KCAL * Math.max(1, mouths));
  return Math.min(1, Math.max(0, 1 - days / PRESS_DAYS));
}

/**
 * Pura: los animales del hogar de `me` que pueden tirar ahora y cuánto rinde su hora de campo con su
 * parte del tiro: `1 + Σ (fieldRate - 1) · workers / max(gente, puestos)`, cada animal por lo que
 * le deja el cansancio (con `fatigue`). `use`: las horas de cada animal que se lleva una hora de
 * campo (`workers / max(gente, puestos)`), solo de los que tienen fila de cansancio. Sin animal, nada.
 */
export function draftFor(
  truth: ReadonlyWorldTruth,
  me: AgentId,
  now: Tick,
  o: DraftOptions,
  ledger?: ReadonlyLedger,
):
  | {
      readonly animals: readonly AnimalId[];
      readonly rate: number;
      readonly use: readonly { readonly animal: AnimalId; readonly hours: number }[];
    }
  | undefined {
  if (o.defs.size === 0) return undefined;
  const household = truth.get(PERSON, me)?.household;
  if (household === undefined) return undefined;
  const animals: { id: AnimalId; def: DraftDef; factor: number; tracked: boolean }[] = [];
  const warmth = o.restChoice === true ? (truth.get(INNATE, me)?.["warmth"] ?? 0) : undefined;
  const believed = o.restBelief === true ? truth.get(INVENTORY_BELIEF, me) : undefined;
  const larder =
    o.restChoice === true && o.restPress === true && ledger !== undefined
      ? larderPress(
          believed !== undefined
            ? (believed.larder.find((h) => h.unit === HARVEST_GOOD)?.amount ?? 0)
            : (ledger
                .holdings(holderAccount(household as unknown as HolderRef))
                .find((h) => h.unit === HARVEST_GOOD)?.amount ?? 0),
          (truth.ids(PERSON) as AgentId[]).filter(
            (id) =>
              truth.get(PERSON, id)?.household === household &&
              truth.get(ENTITY, id)?.endedAt === undefined,
          ).length,
        )
      : 0;
  const harvest =
    o.restChoice === true && o.restSeason !== undefined
      ? seasonPress(o.restSeason.season, o.restSeason.dayAt(now))
      : 0;
  const press = Math.max(larder, harvest);
  for (const id of [...truth.ids(ANIMAL)].sort() as AnimalId[]) {
    const a = truth.get(ANIMAL, id);
    if (!a || a.owner !== household || truth.get(ENTITY, id)?.endedAt !== undefined) continue;
    const def = o.defs.get(a.species);
    if (def === undefined || (now - a.bornAt) / o.year < def.minAgeYears) continue;
    if ((truth.get(ANIMAL_HUNGER, id)?.level ?? 0) >= def.hungerStop) continue;
    const row = o.fatigue === true ? truth.get(DRAFT_FATIGUE, id) : undefined;
    const restAbove = warmth === undefined ? undefined : draftRestThreshold(def, warmth, press);
    const factor = draftFatigueFactor(def, row, o.rest === true, restAbove);
    if (factor <= 0) continue;
    animals.push({ id, def, factor, tracked: row !== undefined });
  }
  if (animals.length === 0) return undefined;
  const workers = (truth.ids(PERSON) as AgentId[])
    .filter((id) => {
      const p = truth.get(PERSON, id);
      return (
        p?.household === household &&
        truth.get(ENTITY, id)?.endedAt === undefined &&
        (now - p.born) / o.year >= o.workAge
      );
    })
    .sort();
  if (!workers.includes(me)) return undefined;
  const seats = animals.reduce((n, a) => n + a.def.workers, 0);
  const people = Math.max(workers.length, seats);
  const gain = animals.reduce(
    (n, a) => n + ((a.def.fieldRate - 1) * a.def.workers * a.factor) / people,
    0,
  );
  const use = animals
    .filter((a) => a.tracked)
    .map((a) => ({ animal: a.id, hours: a.def.workers / people }));
  return { animals: animals.map((a) => a.id), rate: 1 + gain, use };
}
