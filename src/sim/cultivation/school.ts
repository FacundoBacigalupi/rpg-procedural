// La escuela de una secta (novel-cult-school, cultivation §2): la ley tiene umbrales reales sin
// nombre; cada escuela los agrupa en reinos con nombre y capas (un mapeo cultural sobre la verdad) y
// tiene una técnica de entrada que enseña a quien acepta. Los nombres salen de `content/schools/`
// por familia de mundo; la secta elige uno por reino y cuántos umbrales le caben a cada uno.
// Más arriba, un método por reino (novel2-method-school): el de entrada es el del primero; cada
// método rinde solo hasta su reino, y romper hacia un tramo que el método que uno sabe no cubre es
// ir a ciegas (la preparación baja). Sin método, se intuyen los primeros tramos y nada más.
// Todavía sin mapeos equivocados (un reino partido donde no hay barrera, dos umbrales juntados en
// uno): cada borde de capa es un umbral de la ley.

import {
  contentId,
  defineContent,
  type EntityRef,
  type Rng,
  type Tick,
  z,
} from "../../core/index.ts";
import { table } from "../world/index.ts";
import type { CultivationLaw } from "./law.ts";

/** Los nombres que usa una familia de mundos: alternativas por reino, la palabra para «capa», técnicas. */
export const SchoolNames = z.strictObject({
  id: contentId,
  family: contentId,
  layer: z.string().min(1),
  realms: z.array(z.array(z.string().min(1)).min(1)).min(2),
  techniques: z.array(z.string().min(1)).min(1),
});
export type SchoolNames = z.infer<typeof SchoolNames>;
export const SCHOOLS = defineContent("schools", SchoolNames);

/** Un reino de la escuela: su nombre y qué tramos de la ley cubre (`from`..`to`, inclusive). */
export interface SchoolRealm {
  readonly name: string;
  readonly from: number;
  readonly to: number;
}

/** La técnica de entrada: con qué nombre se enseña y cuánto rinde al meditar y absorber. */
export interface EntryTechnique {
  readonly name: string;
  /** Multiplica lo que da meditar y lo que pide absorber (sin calibrar). */
  readonly factor: number;
}

/** El método de un reino de la escuela: el de entrada es el del reino 0. */
export interface SchoolMethod extends EntryTechnique {
  /** El índice del reino (en `realms`) que cubre. */
  readonly realm: number;
}

export interface School {
  readonly realms: readonly SchoolRealm[];
  /** La palabra para las capas de un reino («capa»). */
  readonly layer: string;
  readonly technique: EntryTechnique;
  /** Un método por reino, en orden (novel2-method-school); sin él, solo la técnica de entrada. */
  readonly methods?: readonly SchoolMethod[];
}

/** La escuela, en la entidad de la secta. */
export const SECT_SCHOOL = table<School>("cultivation.school");

/** Lo que rinde la técnica de entrada, entre estos extremos. */
export const TECHNIQUE_FACTOR = [1.2, 1.6] as const;

/** Lo que rinde el método de un reino más alto, entre estos extremos (sin calibrar). */
export const METHOD_FACTOR = [1.2, 1.8] as const;

/** Cuánto queda de la preparación al romper a ciegas, sin método que cubra el tramo (sin calibrar). */
export const BLIND_PREP = 0.5;

/** Sin método, los primeros tramos se intuyen (el primer reino de toda escuela cabe en ellos). */
export const UNGUIDED_TRAMOS = 3;

/**
 * La escuela de una secta: recorre los tramos de la ley (uno por umbral, desde el 0) y los reparte
 * en reinos de una a tres capas (el primero, de dos a tres); los nombres que sobran no se usan y si
 * faltan, el último reino se queda con lo que queda.
 */
export function generateSchool(rng: Rng, law: CultivationLaw, names: SchoolNames): School {
  const n = law.paths[0]?.thresholds.length ?? 0;
  const realms: SchoolRealm[] = [];
  let from = 0;
  for (const [i, options] of names.realms.entries()) {
    if (from >= n) break;
    const last = i === names.realms.length - 1;
    const size = last
      ? n - from
      : i === 0
        ? rng.fork("size", i).int(2, 3)
        : rng.fork("size", i).int(1, 3);
    const to = Math.min(n - 1, from + size - 1);
    const name = options[rng.fork("name", i).int(0, options.length - 1)] as string;
    realms.push({ name, from, to });
    from = to + 1;
  }
  const t = rng.fork("technique");
  const name = names.techniques[t.int(0, names.techniques.length - 1)] as string;
  const factor =
    Math.round(
      (TECHNIQUE_FACTOR[0] + (TECHNIQUE_FACTOR[1] - TECHNIQUE_FACTOR[0]) * t.float()) * 100,
    ) / 100;
  // Los métodos de los reinos de arriba: nombres sin repetir mientras alcancen; después, partes.
  const methods: SchoolMethod[] = [{ name, factor, realm: 0 }];
  const left = names.techniques.filter((x) => x !== name);
  for (let i = 1; i < realms.length; i++) {
    const m = rng.fork("method", i);
    const pick = left.length > 0 ? m.int(0, left.length - 1) : -1;
    const base = pick >= 0 ? (left.splice(pick, 1)[0] as string) : `${name}, parte ${i + 1}`;
    const f =
      Math.round((METHOD_FACTOR[0] + (METHOD_FACTOR[1] - METHOD_FACTOR[0]) * m.float()) * 100) /
      100;
    methods.push({ name: base, factor: f, realm: i });
  }
  return { realms, layer: names.layer, technique: { name, factor }, methods };
}

/** El índice del reino de un tramo según la escuela; pasado el último umbral, el último. */
export function realmIndex(school: School, stage: number): number {
  const i = school.realms.findIndex((r) => stage >= r.from && stage <= r.to);
  return i >= 0 ? i : Math.max(0, school.realms.length - 1);
}

/** Si el método que alguien sabe cubre un tramo: el de su reino y los de abajo. */
export function methodCovers(school: School, known: KnownTechnique, stage: number): boolean {
  return realmIndex(school, stage) <= (known.realm ?? 0);
}

/**
 * Si romper desde `stage` (hacia `stage + 1`) va a ciegas: con método, si no cubre el tramo al que
 * se llega; sin método (o sin la escuela que lo enseñó), pasados los tramos que se intuyen.
 */
export function breaksBlind(
  school: School | undefined,
  known: KnownTechnique | undefined,
  stage: number,
): boolean {
  const target = stage + 1;
  if (known && school) return !methodCovers(school, known, target);
  return target >= UNGUIDED_TRAMOS;
}

/** El reino y la capa de un tramo según la escuela; pasado el último umbral, la cima del último. */
export function realmOf(
  school: School,
  stage: number,
): { readonly name: string; readonly layer?: number } | undefined {
  const last = school.realms[school.realms.length - 1];
  if (!last) return undefined;
  const realm = school.realms.find((r) => stage >= r.from && stage <= r.to) ?? last;
  const layers = realm.to - realm.from + 1;
  if (layers <= 1) return { name: realm.name };
  return { name: realm.name, layer: Math.min(layers, stage - realm.from + 1) };
}

export const TECHNIQUE_TAUGHT_EVENT = "cultivation.technique_taught";

/** Lo que alguien sabe de la técnica de entrada de una secta (conocimiento, se lo enseñaron). */
export interface KnownTechnique {
  readonly org: EntityRef;
  readonly name: string;
  readonly factor: number;
  readonly learnedAt: Tick;
  /** El reino de la escuela que cubre (novel2-method-school); sin él, el primero. */
  readonly realm?: number;
}

export const CULTIVATION_TECHNIQUE = table<KnownTechnique>("cultivation.technique");
