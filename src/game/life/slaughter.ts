// Carnear un animal de la casa (livestock-slaughter): el jugador nombra la especie («carneo la
// cabra») y se elige, en orden canónico, uno vivo de su hogar que esté en su mismo hex. Lo que deja
// el cuerpo (`carcassYield`) entra a la despensa del hogar desde `CARCASS_SOURCE`, como cuando
// muere de viejo; el animal termina. Solo los de su casa: tomar el ajeno es robo (livestock-tenure).
// Regalarlo (livestock-tenure-gift): «le doy la gallina a Lin» elige igual el animal (la especie
// tiene que estar nombrada) y, si sale bien, pasa a ser del hogar del otro y de su casa.

import {
  type AnimalId,
  type BuildingId,
  compareStrings,
  type Duration,
  type EventId,
  externalAccount,
  type HolderRef,
  type HouseholdId,
  type LedgerUnit,
  ledgerUnit,
  type Tick,
} from "../../core/index.ts";
import {
  ANIMAL,
  ANIMAL_HUNGER,
  BUILDING,
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
  setComponent,
} from "../../sim/index.ts";
import { type AnimalMark, animalMarksOf } from "./animal-marks.ts";

export interface SlaughterOptions {
  readonly species: readonly LivestockDef[];
  /** Duración del año (ticks). */
  readonly year: Duration;
  /**
   * Opt-in (livestock-slaughter-refs): las palabras que dicen algo del animal («la vieja», «el
   * cabrito», «la flaca», «la que da de mamar», «el macho») eligen uno al que se le note eso
   * (`animalMarksOf`, sexo); si ninguno encaja, no hay a cuál. Sin esto, solo la especie.
   */
  readonly refs?: boolean;
  /** Opt-in (livestock-tenure-gift): «dar» un animal de la casa lo pasa al hogar de quien lo recibe. */
  readonly gift?: boolean;
}

/** Palabras que dicen algo de un animal en particular (livestock-slaughter-refs). */
const QUALIFIERS: Readonly<Record<string, AnimalMark | "male" | "female">> = {
  cria: "young",
  crias: "young",
  cabrito: "young",
  cabritos: "young",
  pollito: "young",
  pollitos: "young",
  cachorro: "young",
  ternero: "young",
  joven: "young",
  chico: "young",
  chica: "young",
  viejo: "old",
  vieja: "old",
  viejos: "old",
  viejas: "old",
  flaco: "thin",
  flaca: "thin",
  consumido: "starving",
  consumida: "starving",
  parida: "nursing",
  lechera: "nursing",
  mamar: "nursing",
  amamanta: "nursing",
  macho: "male",
  gallo: "male",
  hembra: "female",
  perra: "female",
};

/** Pura: si al animal se le nota `q` (el consumido también está flaco). */
function fits(q: AnimalMark | "male" | "female", sex: string, marks: readonly AnimalMark[]) {
  if (q === "male" || q === "female") return sex === q;
  if (q === "thin") return marks.includes("thin") || marks.includes("starving");
  return marks.includes(q);
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
 * que haya; con `mustName`, solo si nombra una especie). Sin uno así, nada.
 */
function animalOf(
  truth: ReadonlyWorldTruth,
  me: string,
  text: string | undefined,
  now: Tick,
  o: SlaughterOptions,
  mustName = false,
): { id: AnimalId; def: LivestockDef; bornAt: Tick; household: string } | undefined {
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
  const wanted =
    o.refs === true
      ? [...words].flatMap((w) => {
          const q = QUALIFIERS[w];
          return q === undefined ? [] : [q];
        })
      : [];
  // Nombró algo que no es una especie de la casa («el cerdo»): no hay a cuál.
  const vague = [...words].every((w) => VAGUE.has(w) || (o.refs === true && w in QUALIFIERS));
  if (!anyNamed && (!vague || mustName)) return undefined;
  for (const id of [...truth.ids(ANIMAL)].sort(compareStrings) as AnimalId[]) {
    const a = truth.get(ANIMAL, id);
    if (!a || a.owner !== household || truth.get(ENTITY, id)?.endedAt !== undefined) continue;
    if (truth.get(LOCATION, id)?.hex !== hex) continue;
    const def = byId.get(a.species);
    if (def === undefined || (anyNamed && !named(def))) continue;
    if (wanted.length > 0) {
      const marks = animalMarksOf(truth, id, a.bornAt, def, now, o.year);
      if (!wanted.every((q) => fits(q, a.sex, marks))) continue;
    }
    return { id, def, bornAt: a.bornAt, household };
  }
  return undefined;
}

/**
 * Pura: el animal de su casa que nombra `text` (`animalOf`), con la despensa adonde va y lo que
 * deja. Sin uno así, nada.
 */
export function slaughterTargetOf(
  truth: ReadonlyWorldTruth,
  me: string,
  text: string | undefined,
  now: Tick,
  o: SlaughterOptions,
): NonNullable<ResolveInput["slaughterTarget"]> | undefined {
  const t = animalOf(truth, me, text, now, o);
  if (t === undefined) return undefined;
  const yields: { unit: LedgerUnit; grams: number }[] = carcassYield(
    t.def,
    (now - t.bornAt) / o.year,
  ).map((y) => ({ unit: ledgerUnit(`good:${y.good}`), grams: y.grams }));
  return {
    animal: t.id,
    holder: t.household as unknown as HolderRef,
    source: externalAccount(CARCASS_SOURCE),
    yields,
  };
}

/** El animal que se regala y adónde va: el hogar de quien lo recibe y su primera casa. */
export interface AnimalGift {
  readonly animal: AnimalId;
  readonly household: HouseholdId;
  readonly home: BuildingId;
}

/**
 * Pura (livestock-tenure-gift): el animal de su casa que nombra `text` (la especie tiene que estar
 * dicha) para dárselo a `to`, si `to` vive, está en su hex y es de otro hogar con casa. Sin eso, nada.
 */
export function giftTargetOf(
  truth: ReadonlyWorldTruth,
  me: string,
  to: string | undefined,
  text: string | undefined,
  now: Tick,
  o: SlaughterOptions,
): AnimalGift | undefined {
  if (to === undefined || truth.get(ENTITY, to as never)?.endedAt !== undefined) return undefined;
  const theirs = truth.get(PERSON, to as never)?.household;
  const mine = truth.get(PERSON, me as never)?.household;
  if (theirs === undefined || theirs === mine) return undefined;
  if (truth.get(LOCATION, to as never)?.hex !== truth.get(LOCATION, me as never)?.hex) {
    return undefined;
  }
  const home = ([...truth.ids(BUILDING)].sort(compareStrings) as BuildingId[]).find(
    (b) =>
      truth.get(BUILDING, b)?.household === theirs && truth.get(ENTITY, b)?.endedAt === undefined,
  );
  if (home === undefined) return undefined;
  const t = animalOf(truth, me, text, now, o, true);
  return t === undefined ? undefined : { animal: t.id, household: theirs, home };
}

/** Pura: el animal regalado pasa a ser del otro hogar y de su casa. */
export function giftChanges(truth: ReadonlyWorldTruth, g: AnimalGift): StateChange[] {
  const a = truth.get(ANIMAL, g.animal);
  return a ? [setComponent(ANIMAL, g.animal, { ...a, owner: g.household, home: g.home })] : [];
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
