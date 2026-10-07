// Los nombres de la gente y de los lugares (language §8, §9): se eligen entre significados que
// valen en la cultura y la lengua les da forma. El apellido pasa de padre a hijo; quien llega de
// afuera trae el suyo. Cada parte guarda de qué conceptos está hecha y qué evento la puso, así
// que un nombre se puede rastrear hasta sus raíces. Se escribe en la verdad porque la sim lo
// decidió; la lengua misma no se guarda, se rehace del seed.

import {
  type AgentId,
  compareStrings,
  type EntityRef,
  type EventId,
  type HouseholdId,
  type Random,
  Rng,
  type Seed,
} from "../../core/index.ts";
import { PERSON } from "../family/index.ts";
import { ENTITY, table, type WorldTruth } from "../world/index.ts";
import type { PlaceFeature } from "./defs.ts";
import { capitalize, type Language } from "./language.ts";

/** Quién usa la parte: en una aldea todos llaman por el nombre de pila (language §8). */
export type NameUse = "all" | "family" | "intimates";

export interface NamePart {
  readonly kind: "family" | "given";
  /** De qué raíces está hecho (ids de léxico). */
  readonly lexemes: readonly string[];
  /** Los conceptos que significa, en orden de lectura. */
  readonly meaning: readonly string[];
  /** Romanizado, con mayúscula. */
  readonly form: string;
  /** Quién lo puso: el apellido se hereda (`null`) y el nombre de pila lo pone quien cría. */
  readonly givenBy: AgentId | null;
  /** El evento que lo puso: el nacimiento o la llegada. */
  readonly event: EventId;
  readonly usedBy: NameUse;
}

export interface PersonName {
  readonly language: string;
  readonly parts: readonly NamePart[];
}

export interface PlaceName {
  readonly language: string;
  readonly lexemes: readonly string[];
  readonly meaning: readonly string[];
  readonly form: string;
  readonly event: EventId;
}

export const PERSON_NAME = table<PersonName>("language.person_name");
export const PLACE_NAME = table<PlaceName>("language.place_name");

/** Cómo lo llaman todos: el nombre de pila. */
export function callName(name: PersonName): string | undefined {
  return name.parts.find((p) => p.kind === "given")?.form;
}

/** El apellido de linaje, si tiene. */
export function familyName(name: PersonName): string | undefined {
  return name.parts.find((p) => p.kind === "family")?.form;
}

/** El nombre completo en el orden de la lengua (`names.order`). */
export function fullName(language: Language, name: PersonName): string {
  const family = familyName(name);
  const given = callName(name);
  const order = language.spec.names.order === "family-first" ? [family, given] : [given, family];
  return order.filter((x): x is string => x !== undefined).join(" ");
}

type Sexed = "male" | "female";

function weightsFor(
  language: Language,
  key: Sexed | "family" | "place",
  exclude: ReadonlySet<string> = new Set(),
): { ids: string[]; weights: number[] } {
  const ids: string[] = [];
  const weights: number[] = [];
  for (const c of [...language.concepts.values()].sort((a, b) => compareStrings(a.id, b.id))) {
    const w = c.name?.[key] ?? 0;
    if (w > 0 && !exclude.has(c.id)) {
      ids.push(c.id);
      weights.push(w);
    }
  }
  return { ids, weights };
}

/** Un nombre de pila: uno o dos elementos con significado de los que se desean para ese chico. */
function givenOf(language: Language, sex: Sexed, rng: Random) {
  const { ids, weights } = weightsFor(language, sex);
  const first = ids[rng.weighted(weights)] as string;
  if (!rng.chance(language.spec.names.compoundGivenChance)) return language.compound([first]);
  const rest = weightsFor(language, sex, new Set([first]));
  const second = rest.ids[rng.weighted(rest.weights)] as string;
  // Un adjetivo modifica al sustantivo: "claro agua"; dos sustantivos, en el orden en que salieron.
  const adj = (id: string) => language.concepts.get(id)?.pos === "adj";
  return language.compound(adj(second) && !adj(first) ? [second, first] : [first, second]);
}

function partOf(
  kind: NamePart["kind"],
  lexeme: ReturnType<Language["compound"]>,
  givenBy: AgentId | null,
  event: EventId,
  usedBy: NameUse,
): NamePart {
  return {
    kind,
    lexemes: lexeme.origin.kind === "compound" ? lexeme.origin.parts : [lexeme.id],
    meaning: lexeme.gloss,
    form: capitalize(lexeme.text),
    givenBy,
    event,
    usedBy,
  };
}

/** Intentos por nombre de pila para no repetir el de alguien de la casa. */
const GIVEN_TRIES = 12;

/**
 * Le pone nombre a toda la gente de la aldea (los vivos y los que ya no están). Va por orden de
 * nacimiento: el padre se nombra antes que sus hijos y les pasa el apellido.
 */
export function seedPersonNames(truth: WorldTruth, language: Language, seed: Seed): void {
  const people = (truth.ids(PERSON) as AgentId[])
    .flatMap((id) => {
      const p = truth.get(PERSON, id);
      return p ? [{ id, p }] : [];
    })
    .sort((a, b) => a.p.born - b.p.born || compareStrings(a.id, b.id));
  const root = Rng.root(seed).fork("lang", language.id, "people");
  const families = new Set<string>();
  const familyOf = new Map<AgentId, NamePart>();
  const usedGiven = new Map<HouseholdId, Set<string>>();

  for (const { id, p } of people) {
    const rng = root.fork(id);
    const event = truth.get(ENTITY, id)?.originEventId as EventId;
    const raisedBy = p.father ?? p.mother;

    let family = p.father ? familyOf.get(p.father) : undefined;
    if (family === undefined) {
      const { ids, weights } = weightsFor(language, "family", families);
      const pool = ids.length > 0 ? { ids, weights } : weightsFor(language, "family");
      const concept = pool.ids[rng.fork("family").weighted(pool.weights)] as string;
      family = partOf("family", language.compound([concept]), null, event, "all");
      families.add(concept);
    } else {
      family = { ...family, event, givenBy: null };
    }
    familyOf.set(id, family);

    const used = usedGiven.get(p.household) ?? new Set<string>();
    usedGiven.set(p.household, used);
    const sex: Sexed = p.sex === "female" ? "female" : "male";
    let given = givenOf(language, sex, rng.fork("given", 0));
    for (let i = 1; i < GIVEN_TRIES && used.has(given.text); i++) {
      given = givenOf(language, sex, rng.fork("given", i));
    }
    used.add(given.text);

    truth.set(PERSON_NAME, id, {
      language: language.id,
      parts: [family, partOf("given", given, raisedBy, event, "all")],
    });
  }
}

/** Un lugar con nombre por sus rasgos: lo que lo describe (modificador) y lo que es (cabeza). */
export interface PlaceToName {
  readonly id: EntityRef;
  readonly feature: PlaceFeature;
  readonly event: EventId;
}

export function seedPlaceNames(
  truth: WorldTruth,
  language: Language,
  seed: Seed,
  places: readonly PlaceToName[],
): void {
  const root = Rng.root(seed).fork("lang", language.id, "places");
  const heads = new Map<PlaceFeature, string[]>();
  for (const c of [...language.concepts.values()].sort((a, b) => compareStrings(a.id, b.id))) {
    if (c.feature === undefined) continue;
    heads.set(c.feature, [...(heads.get(c.feature) ?? []), c.id]);
  }
  const taken = new Set<string>();
  for (const place of places) {
    const options = heads.get(place.feature) ?? [];
    if (options.length === 0) continue;
    const rng = root.fork(place.id);
    const head = options[rng.fork("head").int(0, options.length - 1)] as string;
    let lexeme = language.compound([head]);
    for (let i = 0; i < GIVEN_TRIES; i++) {
      const r = rng.fork("modifier", i);
      const { ids, weights } = weightsFor(language, "place", new Set([head]));
      const modifier = ids[r.weighted(weights)] as string;
      lexeme = language.compound([modifier, head]);
      if (!taken.has(lexeme.text)) break;
    }
    taken.add(lexeme.text);
    truth.set(PLACE_NAME, place.id, {
      language: language.id,
      lexemes: lexeme.origin.kind === "compound" ? lexeme.origin.parts : [lexeme.id],
      meaning: lexeme.gloss,
      form: capitalize(lexeme.text),
      event: place.event,
    });
  }
}
