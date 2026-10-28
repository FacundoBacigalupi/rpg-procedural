// Carnear un animal de la casa (livestock-slaughter): el jugador nombra la especie («carneo la
// cabra») y se elige, en orden canónico, uno vivo de su hogar que esté en su mismo hex. Lo que deja
// el cuerpo (`carcassYield`) entra a la despensa del hogar desde `CARCASS_SOURCE`, como cuando
// muere de viejo; el animal termina. Solo los de su casa: tomar el ajeno es robo (livestock-tenure).

import {
  type AnimalId,
  compareStrings,
  type Duration,
  type EventId,
  externalAccount,
  type HolderRef,
  type LedgerUnit,
  ledgerUnit,
  type Tick,
} from "../../core/index.ts";
import {
  ANIMAL,
  ANIMAL_HUNGER,
  CARCASS_SOURCE,
  carcassYield,
  DRAFT_FATIGUE,
  deleteComponent,
  ENTITY,
  endEntity,
  LACTATING,
  type LivestockDef,
  LOCATION,
  PERSON,
  type ReadonlyWorldTruth,
  type ResolveInput,
  type StateChange,
} from "../../sim/index.ts";

export interface SlaughterOptions {
  readonly species: readonly LivestockDef[];
  /** Duración del año (ticks). */
  readonly year: Duration;
}

/** Las tablas que lee `slaughterTargetOf` (para declararlas en el proceso). */
export const SLAUGHTER_READS = [
  ANIMAL.name,
  ENTITY.name,
  PERSON.name,
  LOCATION.name,
  ANIMAL_HUNGER.name,
  LACTATING.name,
  DRAFT_FATIGUE.name,
] as const;

/** Las tablas que escribe `slaughterChanges`. */
export const SLAUGHTER_WRITES = [
  ENTITY.name,
  LOCATION.name,
  ANIMAL_HUNGER.name,
  LACTATING.name,
  DRAFT_FATIGUE.name,
] as const;

/** Palabras que no nombran especie: sin otra, sirve cualquier animal de la casa. */
const VAGUE = new Set([
  "el",
  "la",
  "los",
  "las",
  "un",
  "una",
  "mi",
  "mis",
  "nuestro",
  "nuestra",
  "animal",
  "bicho",
]);

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Pura: el animal vivo del hogar de `me`, en su hex, cuya especie nombra `text` (sin texto, el primero
 * que haya), con la despensa adonde va y lo que deja. Sin uno así, nada.
 */
export function slaughterTargetOf(
  truth: ReadonlyWorldTruth,
  me: string,
  text: string | undefined,
  now: Tick,
  o: SlaughterOptions,
): NonNullable<ResolveInput["slaughterTarget"]> | undefined {
  const household = truth.get(PERSON, me as never)?.household;
  const hex = truth.get(LOCATION, me as never)?.hex;
  if (household === undefined || hex === undefined) return undefined;
  const words = new Set(
    fold(text ?? "")
      .split(/[^a-zñ]+/)
      .filter((w) => w.length > 0),
  );
  const named = (def: LivestockDef) => {
    const name = fold(def.name);
    return words.has(name) || words.has(`${name}s`) || words.has(`${name}es`);
  };
  const byId = new Map(o.species.map((s) => [s.id, s]));
  const anyNamed = o.species.some(named);
  // Nombró algo que no es una especie de la casa («el cerdo»): no hay a cuál.
  const vague = [...words].every((w) => VAGUE.has(w));
  if (!anyNamed && !vague) return undefined;
  for (const id of [...truth.ids(ANIMAL)].sort(compareStrings) as AnimalId[]) {
    const a = truth.get(ANIMAL, id);
    if (!a || a.owner !== household || truth.get(ENTITY, id)?.endedAt !== undefined) continue;
    if (truth.get(LOCATION, id)?.hex !== hex) continue;
    const def = byId.get(a.species);
    if (def === undefined || (anyNamed && !named(def))) continue;
    const yields: { unit: LedgerUnit; grams: number }[] = carcassYield(
      def,
      (now - a.bornAt) / o.year,
    ).map((y) => ({ unit: ledgerUnit(`good:${y.good}`), grams: y.grams }));
    return {
      animal: id,
      holder: household as unknown as HolderRef,
      source: externalAccount(CARCASS_SOURCE),
      yields,
    };
  }
  return undefined;
}

/** Pura: lo que cambia al carnear `animal`: termina con `event` y se borran sus filas de vida. */
export function slaughterChanges(
  truth: ReadonlyWorldTruth,
  animal: AnimalId,
  event: EventId,
  now: Tick,
): StateChange[] {
  const base = truth.get(ENTITY, animal);
  if (!base) return [];
  const changes: StateChange[] = [endEntity(base, event, now), deleteComponent(LOCATION, animal)];
  if (truth.get(ANIMAL_HUNGER, animal)) changes.push(deleteComponent(ANIMAL_HUNGER, animal));
  if (truth.get(LACTATING, animal)) changes.push(deleteComponent(LACTATING, animal));
  if (truth.get(DRAFT_FATIGUE, animal)) changes.push(deleteComponent(DRAFT_FATIGUE, animal));
  return changes;
}
