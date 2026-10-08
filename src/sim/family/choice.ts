// El temperamento elegido (game-modes §2.1-§2.2, npc-psychology §1): el pedido es un rango por eje
// y se resuelve en los tres pasos de §2.2. (1) Si el temperamento que el mundo le dio al bebé ya
// cae en el rango, es del mundo. (2) Si no, se condiciona el genoma: se vuelve a tirar el valor
// genético del eje (con el mismo prior que da la herencia: la media de los padres y la varianza de
// la segregación) y el ambiente, hasta que la expresión caiga en el rango. (3) Si ni así sale con un
// número acotado de intentos, se fija en el borde más cercano del rango, marcado `novel_setup`.
// Cada eje deja su registro para la crónica (qué salió del mundo, qué se condicionó, qué se fijó).
//
// Puro y determinista: cada eje usa su propio fork, así pedir otro eje no corre los demás.

import { contentId, type Rng, sqrt, z } from "../../core/index.ts";
import type { Genome, Innate, Sex, Trait } from "./genome.ts";

/** Un rango pedido sobre un eje, en la unidad del rasgo ([-1, 1] en el temperamento). */
export const AxisRange = z
  .strictObject({ min: z.number(), max: z.number() })
  .refine((r) => r.min <= r.max, "el mínimo pasa al máximo");
export type AxisRange = z.infer<typeof AxisRange>;

/** Los ejes pedidos; los que no están salen del mundo. */
export const TemperamentSpec = z.record(contentId, AxisRange);
export type TemperamentSpec = z.infer<typeof TemperamentSpec>;

/** Un rango alrededor de un valor («bastante audaz» = `around(0.7, 0.15)`). */
export function around(value: number, tolerance: number): AxisRange {
  return { min: value - tolerance, max: value + tolerance };
}

/** Intentos de condicionar un eje antes de fijarlo. */
export const CONDITION_TRIES = 64;

export type ChoiceHow = "world" | "conditioned" | "fixed";

/** Qué pasó con un eje pedido (para la crónica, §2.2: «distingue lo que salió del mundo…»). */
export interface AxisChoice {
  readonly trait: string;
  readonly how: ChoiceHow;
  /** Solo si se fijó (§2.2 paso 3): el motivo del evento de origen. */
  readonly cause?: "novel_setup";
  /** Cuántos intentos hizo el condicionamiento. */
  readonly tries: number;
  readonly value: number;
}

/** Problemas de un pedido contra el contenido: eje que no existe, no es de temperamento o imposible. */
export function validateTemperament(spec: TemperamentSpec, traits: readonly Trait[]): string[] {
  const problems: string[] = [];
  for (const [id, r] of Object.entries(spec).sort(([a], [b]) => (a < b ? -1 : 1))) {
    const t = traits.find((x) => x.id === id);
    if (!t) problems.push(`${id}: no es un rasgo de esta especie`);
    else if (t.group !== "temperament") problems.push(`${id}: no es un eje de temperamento`);
    else if (r.max < t.min || r.min > t.max)
      problems.push(`${id}: el rango pedido queda fuera de [${t.min}, ${t.max}]`);
  }
  return problems;
}

/** Cuánto se aleja `innate` del pedido: suma de excesos fuera del rango (0 = lo cumple). */
export function temperamentDistance(innate: Innate, spec: TemperamentSpec): number {
  let d = 0;
  for (const [id, r] of Object.entries(spec)) {
    const v = innate[id] ?? 0;
    d += v < r.min ? r.min - v : v > r.max ? v - r.max : 0;
  }
  return Math.round(d * 1e6) / 1e6;
}

/**
 * Puntaje de un nacimiento candidato para el paso 1 (§2.2): 0 si cumple todo, más alto cuanto más
 * lejos. Sirve de peso en la búsqueda (`1 / (1 + distancia)`), no como corte.
 */
export function temperamentFit(innate: Innate, spec: TemperamentSpec): number {
  return Math.round((1 / (1 + temperamentDistance(innate, spec))) * 1e6) / 1e6;
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

export interface ConditionedTemperament {
  readonly genome: Genome;
  readonly innate: Innate;
  readonly choices: readonly AxisChoice[];
}

/**
 * Resuelve el pedido sobre un bebé ya concebido: `innate` es lo que el mundo le dio. `parentMid`
 * da, por eje, la media aditiva de los padres en desvíos (0 para un fundador); `rng` es el stream
 * de la concepción condicionada (`fork("choice", hijo)`). Solo toca los ejes pedidos.
 */
export function conditionTemperament(
  traits: readonly Trait[],
  genome: Genome,
  innate: Innate,
  sex: Sex,
  spec: TemperamentSpec,
  rng: Rng,
  parentMid: Readonly<Record<string, number>> = {},
): ConditionedTemperament {
  const additive: Record<string, number> = { ...genome.additive };
  const out: Record<string, number> = { ...innate };
  const choices: AxisChoice[] = [];
  for (const t of traits) {
    const range = spec[t.id];
    if (range === undefined) continue;
    const now = innate[t.id] ?? t.mean;
    if (now >= range.min && now <= range.max) {
      choices.push({ trait: t.id, how: "world", tries: 0, value: now });
      continue;
    }
    const mean = t.mean + (sex === "male" ? (t.maleShift ?? 0) : 0);
    const axis = rng.fork("axis", t.id);
    const mid = parentMid[t.id] ?? 0;
    const sdGene = sqrt(t.heritability / 2);
    const sdEnv = sqrt(1 - t.heritability);
    let found: { a: number; v: number; tries: number } | null = null;
    for (let i = 1; i <= CONDITION_TRIES; i++) {
      const a = mid + axis.normal(0, sdGene);
      const v = round3(Math.min(t.max, Math.max(t.min, mean + t.sd * (a + axis.normal(0, sdEnv)))));
      if (v >= range.min && v <= range.max) {
        found = { a, v, tries: i };
        break;
      }
    }
    if (found) {
      additive[t.id] = found.a;
      out[t.id] = found.v;
      choices.push({ trait: t.id, how: "conditioned", tries: found.tries, value: found.v });
    } else {
      const edge = Math.min(t.max, Math.max(t.min, now < range.min ? range.min : range.max));
      const v = round3(edge);
      additive[t.id] = (v - mean) / t.sd;
      out[t.id] = v;
      choices.push({
        trait: t.id,
        how: "fixed",
        cause: "novel_setup",
        tries: CONDITION_TRIES,
        value: v,
      });
    }
  }
  return { genome: { ...genome, additive }, innate: out, choices };
}
