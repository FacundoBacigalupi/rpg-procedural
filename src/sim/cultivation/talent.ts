// El talento para cultivar (cultivation §3, novel-cult-law): rasgos heredables y ocultos con el
// mismo modelo aditivo del genoma (family-lineage §1), pero en su propio catálogo
// (`content/talents/`) y su propia tabla, así encender el cultivo no corre el genoma ni lo innato de
// nadie. `spirit_root` dice si hay raíz (arriba del umbral de la ley: pocos), `root_<elemento>`
// cuáles elementos y qué tan puros, `meridians` la conductancia y `comprehension` la facilidad para
// entender. Nadie lo lee directamente: se mide con instrumentos con error o se manifiesta.

import { type AgentId, defineContent, type EventId, type Rng } from "../../core/index.ts";
import {
  expressInnate,
  founderGenome,
  type Genome,
  type Innate,
  inheritGenome,
  type Sex,
  Trait,
} from "../family/index.ts";
import { table } from "../world/index.ts";
import type { CultivationLaw } from "./law.ts";

/** Los rasgos del talento por especie: el mismo esquema que `content/traits/`. */
export const TALENTS = defineContent("talents", Trait);

/** El genoma del talento y su expresión. Verdad oculta, como `GENOME`. */
export interface TalentRecord {
  readonly genome: Genome;
  readonly innate: Innate;
}

export const TALENT = table<TalentRecord>("cultivation.talent");

/** Una raíz: un elemento y qué parte de la raíz es de él (las afinidades suman 1). */
export interface Root {
  readonly element: string;
  readonly affinity: number;
}

/** Lo que la física lee del talento (cultivation §3 `Aptitude`). */
export interface Aptitude {
  /** Vacío: sin raíz, sin camino del qi. */
  readonly roots: readonly Root[];
  /** Pureza general, 0-1: una raíz fuerte y sola cerca de 1; cinco mezcladas, poco; sin raíz, 0. */
  readonly rootQuality: number;
  readonly meridians: number;
  readonly comprehension: number;
}

/** Los padres con su genoma del talento, para heredarlo. */
export interface TalentParents {
  readonly mother: { readonly id: AgentId; readonly genome: Genome };
  readonly father: { readonly id: AgentId; readonly genome: Genome };
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** El valor más alto que puede expresar `spirit_root` (el `max` de su rasgo). */
const ROOT_TOP = 4;

/**
 * El talento según la ley: sin raíz si `spirit_root` no llega a `rootThreshold`; si llega, son raíz
 * los elementos a menos de `rootSpread` del más fuerte, con afinidad según cuánto lo superan. La
 * calidad sube con la fuerza de la raíz y baja con cuántos elementos la parten.
 */
export function aptitudeOf(law: CultivationLaw, innate: Innate): Aptitude {
  const meridians = round3(innate["meridians"] ?? 0.5);
  const comprehension = round3(innate["comprehension"] ?? 0.5);
  const root = innate["spirit_root"] ?? Number.NEGATIVE_INFINITY;
  if (root < law.rootThreshold) return { roots: [], rootQuality: 0, meridians, comprehension };
  const values = law.elements.map((element) => ({ element, v: innate[`root_${element}`] ?? 0 }));
  const top = Math.max(...values.map((x) => x.v));
  const floor = top - law.rootSpread;
  const picked = values
    .filter((x) => x.v >= floor)
    .sort((a, b) => b.v - a.v || (a.element < b.element ? -1 : 1));
  // Cada raíz pesa lo que supera el piso; con un piso exacto, todas igual.
  const weights = picked.map((x) => x.v - floor + 1e-3);
  const total = weights.reduce((s, w) => s + w, 0);
  const roots = picked.map((x, i) => ({
    element: x.element,
    affinity: round3((weights[i] ?? 0) / total),
  }));
  const strength = clamp01((root - law.rootThreshold) / (ROOT_TOP - law.rootThreshold));
  return {
    roots,
    rootQuality: round3((0.3 + 0.7 * strength) / Math.sqrt(roots.length)),
    meridians,
    comprehension,
  };
}

/**
 * El talento de alguien: heredado si se conoce el de los dos padres, del fondo de la población si
 * no. `rng` es `fork("talent", id)`; los flujos de genética y desarrollo salen de él, aparte de los
 * del genoma, para no tocarlos.
 */
export function talentOf(
  talents: readonly Trait[],
  sex: Sex,
  parents: TalentParents | undefined,
  rng: Rng,
  originEventId: EventId,
): TalentRecord {
  const genetics = rng.fork("genetics");
  const genome = parents
    ? inheritGenome(talents, parents.mother, parents.father, genetics, originEventId)
    : founderGenome(talents, genetics, originEventId);
  return { genome, innate: expressInnate(talents, genome, sex, rng.fork("development")) };
}
