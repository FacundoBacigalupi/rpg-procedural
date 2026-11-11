// La escuela de una secta (novel-cult-school, cultivation §2): la ley tiene umbrales reales sin
// nombre; cada escuela los agrupa en reinos con nombre y capas (un mapeo cultural sobre la verdad) y
// tiene una técnica de entrada que enseña a quien acepta. Los nombres salen de `content/schools/`
// por familia de mundo; la secta elige uno por reino y cuántos umbrales le caben a cada uno.
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

export interface School {
  readonly realms: readonly SchoolRealm[];
  /** La palabra para las capas de un reino («capa»). */
  readonly layer: string;
  readonly technique: EntryTechnique;
}

/** La escuela, en la entidad de la secta. */
export const SECT_SCHOOL = table<School>("cultivation.school");

/** Lo que rinde la técnica de entrada, entre estos extremos. */
export const TECHNIQUE_FACTOR = [1.2, 1.6] as const;

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
  return { realms, layer: names.layer, technique: { name, factor } };
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
}

export const CULTIVATION_TECHNIQUE = table<KnownTechnique>("cultivation.technique");
