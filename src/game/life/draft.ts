// El tiro del ganado (livestock-yield-draft): el buey adulto del hogar tira del arado y la hora de
// campo rinde más (`DraftDef.fieldRate`). Cada animal sirve a `workers` personas a la vez; con más
// gente en edad de trabajar que puestos, la ganancia se reparte entre todos (se turnan el arado), así
// que la casa no gana más que lo que el animal da. Uno con mucha hambre no tira.
// Lo que el tiro le cuesta al animal (más comida, cansancio) todavía no entra.

import type { AgentId, AnimalId, Duration, Tick } from "../../core/index.ts";
import {
  ANIMAL,
  ANIMAL_HUNGER,
  type DraftDef,
  ENTITY,
  type LivestockDef,
  PERSON,
  type ReadonlyWorldTruth,
} from "../../sim/index.ts";

/** Las tablas que lee `draftFor` (para declararlas en el proceso). */
export const DRAFT_READS = [ANIMAL.name, ANIMAL_HUNGER.name, PERSON.name, ENTITY.name] as const;

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
}

/**
 * Pura: los animales del hogar de `me` que pueden tirar ahora y cuánto rinde su hora de campo con su
 * parte del tiro: `1 + Σ (fieldRate - 1) · workers / max(gente, puestos)`. Sin animal, nada.
 */
export function draftFor(
  truth: ReadonlyWorldTruth,
  me: AgentId,
  now: Tick,
  o: DraftOptions,
): { readonly animals: readonly AnimalId[]; readonly rate: number } | undefined {
  if (o.defs.size === 0) return undefined;
  const household = truth.get(PERSON, me)?.household;
  if (household === undefined) return undefined;
  const animals: { id: AnimalId; def: DraftDef }[] = [];
  for (const id of [...truth.ids(ANIMAL)].sort() as AnimalId[]) {
    const a = truth.get(ANIMAL, id);
    if (!a || a.owner !== household || truth.get(ENTITY, id)?.endedAt !== undefined) continue;
    const def = o.defs.get(a.species);
    if (def === undefined || (now - a.bornAt) / o.year < def.minAgeYears) continue;
    if ((truth.get(ANIMAL_HUNGER, id)?.level ?? 0) >= def.hungerStop) continue;
    animals.push({ id, def });
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
  const gain = animals.reduce((n, a) => n + ((a.def.fieldRate - 1) * a.def.workers) / people, 0);
  return { animals: animals.map((a) => a.id), rate: 1 + gain };
}
