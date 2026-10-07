// El genoma mínimo (family-lineage §1, Fase 1): solo los rasgos poligénicos (`additive`) de
// temperamento, aptitudes y cuerpo, con su heredabilidad en `content/traits/`. Los genes
// discretos, los linajes de sangre y las mutaciones llegan en la Fase 3.
//
// Modelo aditivo clásico, en desvíos del rasgo: el genoma guarda el valor genético aditivo A, con
// varianza h² en la población fundadora; el hijo hereda el promedio de los padres más la
// segregación (varianza h²/2), así la varianza se mantiene entre generaciones. Lo innato que se ve
// (`Innate`) es A más un ambiente de varianza 1 − h², y la regresión del hijo sobre el promedio de
// los padres da h². El genoma es verdad oculta: nadie lo lee; lo que se ve es lo innato.

import {
  type AgentId,
  contentId,
  defineContent,
  type EventId,
  type Rng,
  sqrt,
  z,
} from "../../core/index.ts";

export const Trait = z.strictObject({
  id: contentId,
  species: contentId,
  /** Nombre para mostrar. */
  name: z.string().min(1),
  /** temperament y aptitude: npc-psychology §1; body: body-health §3. */
  group: z.enum(["temperament", "aptitude", "body"]),
  unit: z.string().min(1).optional(),
  /** Media del rasgo expresado (en las mujeres, si hay `maleShift`). */
  mean: z.number(),
  /** Diferencia media de los varones. */
  maleShift: z.number().optional(),
  sd: z.number().positive(),
  min: z.number(),
  max: z.number(),
  /** Fracción de la varianza que es genética aditiva (family-lineage §1). */
  heritability: z.number().min(0).max(1),
});
export type Trait = z.infer<typeof Trait>;

export const TRAITS = defineContent("traits", Trait);

export type Sex = "female" | "male";

export interface Genome {
  readonly species: string;
  /** Valor genético aditivo de cada rasgo, en desvíos del rasgo expresado. */
  readonly additive: Readonly<Record<string, number>>;
  /**
   * [madre, padre] biológicos; null solo en condiciones iniciales del seed (los fundadores) y en
   * los que llegan de afuera, cuyo origen es su propio evento. El genoma no tiene id propio: es
   * uno por agente y se guarda con el id del agente.
   */
  readonly parents: readonly [AgentId, AgentId] | null;
  /** La concepción (por ahora, el nacimiento) o el evento que trajo al portador al mundo. */
  readonly originEventId: EventId;
}

/** Lo innato tal como se expresa: el genoma más el ambiente. Lo que ven los demás sistemas. */
export type Innate = Readonly<Record<string, number>>;

/** Genoma de alguien sin padres en el mundo: sale de la población que el seed supone. */
export function founderGenome(traits: readonly Trait[], rng: Rng, originEventId: EventId): Genome {
  const additive: Record<string, number> = {};
  for (const t of traits) additive[t.id] = rng.normal(0, sqrt(t.heritability));
  return { species: speciesOf(traits), additive, parents: null, originEventId };
}

/**
 * Genoma del hijo: promedio de los padres más segregación. `rng` es `fork("genetics", hijo)`, así
 * mismos padres, mismo seed y mismo id dan el mismo genoma (también al materializar).
 */
export function inheritGenome(
  traits: readonly Trait[],
  mother: { readonly id: AgentId; readonly genome: Genome },
  father: { readonly id: AgentId; readonly genome: Genome },
  rng: Rng,
  originEventId: EventId,
): Genome {
  const additive: Record<string, number> = {};
  for (const t of traits) {
    const mid = ((mother.genome.additive[t.id] ?? 0) + (father.genome.additive[t.id] ?? 0)) / 2;
    additive[t.id] = mid + rng.normal(0, sqrt(t.heritability / 2));
  }
  return {
    species: speciesOf(traits),
    additive,
    parents: [mother.id, father.id],
    originEventId,
  };
}

/** Lo innato: genoma más ambiente (`fork("development", id)`), acotado al rango del rasgo. */
export function expressInnate(
  traits: readonly Trait[],
  genome: Genome,
  sex: Sex,
  rng: Rng,
): Innate {
  const out: Record<string, number> = {};
  for (const t of traits) {
    const z = (genome.additive[t.id] ?? 0) + rng.normal(0, sqrt(1 - t.heritability));
    const mean = t.mean + (sex === "male" ? (t.maleShift ?? 0) : 0);
    const v = Math.min(t.max, Math.max(t.min, mean + t.sd * z));
    out[t.id] = Math.round(v * 1000) / 1000;
  }
  return out;
}

function speciesOf(traits: readonly Trait[]): string {
  const s = traits[0]?.species;
  if (s === undefined) throw new RangeError("no hay rasgos");
  if (traits.some((t) => t.species !== s)) throw new RangeError("rasgos de especies mezcladas");
  return s;
}
