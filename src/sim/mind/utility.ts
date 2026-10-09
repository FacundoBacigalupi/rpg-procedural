// Decisión por utilidad de los NPC, núcleo puro (npc-psychology §7, Fase 3). Cada acción candidata
// (del mismo catálogo que usa el jugador) se puntúa así:
//
//   U(a) = chance × ganancia − (1 − chance) × pérdida − riesgo × aversión + ánimo
//   ganancia = Σ peso(impulso) × contribución(a, impulso)
//
// Los impulsos son las necesidades inmediatas (hambre, descanso, seguridad, compañía) con el peso
// de su urgencia y los valores de la persona (`valuesOf`) con su peso normalizado. La chance y el
// riesgo son lo que el NPC CREE (autoimagen, creencias sobre el lugar y el otro), no la verdad: lo
// arma quien llama. Elige con softmax y `rng.fork("decision", npc, tick)`: casi siempre la mejor,
// a veces la segunda; la temperatura baja con el control. No lee ni escribe estado: es la parte
// que `life` cablea después (candidatos desde el catálogo, creencias, relaciones).

import { exp, type Rng } from "../../core/index.ts";
import { expectedGain } from "../actions/index.ts";
import type { Innate } from "../family/index.ts";
import { VALUE_IDS, type ValueId } from "./mind.ts";

/** Las necesidades inmediatas que entran a la utilidad (las lentas, `belonging` y `meaning`, aparte). */
export const NEED_IDS = [
  "hunger",
  "thirst",
  "rest",
  "safety",
  "social",
  "pain",
  "craving",
] as const;
export type NeedId = (typeof NEED_IDS)[number];

/** Lo que una acción puede mover: una necesidad o un valor. */
export type UtilityDrive = NeedId | ValueId;

/** Cuánta urgencia tiene cada necesidad ahora, de 0 (saciada) a 1 (apremia). */
export type Needs = Readonly<Partial<Record<NeedId, number>>>;

export interface Candidate {
  /** Identifica la opción (verbo y objetivo); desempata por orden y es lo que se devuelve. */
  readonly id: string;
  /** El verbo del catálogo. */
  readonly verb: string;
  /** A quién va dirigida, si a alguien. */
  readonly target?: string;
  /** De -1 a 1: cuánto acerca (o aleja) cada impulso si sale bien. */
  readonly contributes: Readonly<Partial<Record<UtilityDrive, number>>>;
  /** Chance de éxito CREÍDA (0-1). */
  readonly chance: number;
  /** Lo que se pierde si sale mal, en las mismas unidades que la ganancia. */
  readonly loss?: number;
  /** Lo que se teme que pase, 0-1 (herida, vergüenza, castigo creídos). */
  readonly risk?: number;
  /** Suma directa del ánimo, de gusto o de culpa (±), ya calculada por quien llama. */
  readonly mood?: number;
}

export interface Drives {
  readonly needs: Needs;
  /** Valores normalizados a suma 1 (`valuesOf`). */
  readonly values: Readonly<Partial<Record<ValueId, number>>>;
}

/** Cuánto pesan los valores contra una necesidad apremiante de urgencia 1. */
export const VALUE_SCALE = 1.5;
/** Una necesidad por debajo de esta urgencia no empuja nada. */
export const NEED_FLOOR = 0.05;
/** Ni siquiera el más audaz deja de temer, ni el más miedoso queda paralizado del todo. */
export const AVERSION_MIN = 0.2;
export const AVERSION_MAX = 2;
/** La temperatura del softmax: la del que tiene control 1 y la del que lo tiene 0. */
export const TEMPERATURE_CALM = 0.05;
export const TEMPERATURE_HOT = 0.35;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** El peso con que cada impulso entra a la utilidad ahora. */
export function driveWeight(drives: Drives, drive: UtilityDrive): number {
  const need = (drives.needs as Readonly<Record<string, number | undefined>>)[drive];
  if (need !== undefined) return need < NEED_FLOOR ? 0 : need;
  return (drives.values as Readonly<Record<string, number | undefined>>)[drive] ?? 0;
}

/** Cuánto pesa el riesgo para esta persona: la audacia lo achica, el miedo del momento lo agranda. */
export function aversion(boldness: number, fear: number): number {
  return clamp(1 - 0.6 * boldness + 0.8 * clamp(fear, 0, 1), AVERSION_MIN, AVERSION_MAX);
}

export interface UtilityTemper {
  readonly boldness: number;
  /** 0-1: el miedo del momento. */
  readonly fear?: number;
}

/** La ganancia si sale bien: Σ peso × contribución. */
export function gainOf(c: Candidate, drives: Drives): number {
  let gain = 0;
  for (const [drive, amount] of Object.entries(c.contributes) as [UtilityDrive, number][]) {
    const scale = (VALUE_IDS as readonly string[]).includes(drive) ? VALUE_SCALE : 1;
    gain += driveWeight(drives, drive) * scale * amount;
  }
  return gain;
}

/** La utilidad de una candidata para quien tiene estos impulsos y este temple. */
export function utilityOf(c: Candidate, drives: Drives, temper: UtilityTemper): number {
  const chance = clamp(c.chance, 0, 1);
  const base = expectedGain(chance, gainOf(c, drives), c.loss ?? 0);
  const risk = (c.risk ?? 0) * aversion(temper.boldness, temper.fear ?? 0);
  return base - risk + (c.mood ?? 0);
}

export interface Scored {
  readonly candidate: Candidate;
  readonly utility: number;
}

/** Todas las candidatas con su utilidad, de mejor a peor (a igual utilidad, por id). */
export function rank(
  candidates: readonly Candidate[],
  drives: Drives,
  temper: UtilityTemper,
): Scored[] {
  return candidates
    .map((candidate) => ({ candidate, utility: utilityOf(candidate, drives, temper) }))
    .sort((a, b) => b.utility - a.utility || (a.candidate.id < b.candidate.id ? -1 : 1));
}

/** La temperatura del softmax: más control, más elige siempre la mejor. */
export function temperature(innate: Innate): number {
  const control = clamp(innate["control"] ?? 0.5, 0, 1);
  return TEMPERATURE_CALM + (TEMPERATURE_HOT - TEMPERATURE_CALM) * (1 - control);
}

/** Las chances de elegir cada una, en el orden de `scored` (softmax estable). */
export function choiceOdds(scored: readonly Scored[], temp: number): number[] {
  if (scored.length === 0) return [];
  const top = Math.max(...scored.map((s) => s.utility));
  const w = scored.map((s) => exp((s.utility - top) / temp));
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map((x) => x / sum);
}

/**
 * Elige una candidata con softmax. `rng` ya viene forkeado por quien llama
 * (`rng.fork("decision", npc, tick)`): una tirada fija, así cambiar las candidatas no corre las
 * demás tiradas. Devuelve `undefined` si no hay ninguna.
 */
export function decideByUtility(
  candidates: readonly Candidate[],
  drives: Drives,
  innate: Innate,
  temper: UtilityTemper,
  rng: Rng,
): Scored | undefined {
  const scored = rank(candidates, drives, temper);
  if (scored.length === 0) return undefined;
  const odds = choiceOdds(scored, temperature(innate));
  return scored[rng.weighted(odds)];
}
