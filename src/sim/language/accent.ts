// El acento como firma (language §5, §12). Cada comunidad tiene una variante de su lengua que se
// nota al hablar: un vector de rasgos (vocales, tonos, ritmo, consonantes) que deriva de la
// variante de la que se separó con una deriva propia, así que las vecinas suenan parecido y las
// lejanas, distinto. Quien habla produce su acento nativo mezclado con el que imita según su
// faceta de acento (skills §8); quien escucha lo percibe con el ruido de su oído, lo compara con
// los acentos que conoce y deduce de dónde es, o sospecha del que finge. Todo es puro: el
// diálogo y la percepción deciden cuándo se oye y qué se hace con la sospecha.
//
// Todavía sin cablear: el acento no entra a las creencias sobre quién es el otro ni a la
// persuasión, y la deriva no sigue al cambio fonético (Fase 5); ver ROADMAP.

import type { Random } from "../../core/index.ts";

export const ACCENT_FEATURES = [
  "vowel_height",
  "vowel_length",
  "tone_contour",
  "consonant_force",
  "rhythm",
  "nasality",
  "pitch_range",
] as const;
export type AccentFeature = (typeof ACCENT_FEATURES)[number];

/** Un acento: cada rasgo en 0-1 (la posición en su eje). */
export type Accent = Readonly<Record<AccentFeature, number>>;

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/** Cuánto se mueve cada rasgo por generación de separación (desviación típica). */
export const ACCENT_DRIFT = 0.08;
/** Diferencia media que un oído común todavía no distingue. */
export const ACCENT_JND = 0.04;
/** Ruido del oído sin ninguna habilidad (desviación típica por rasgo). */
export const EAR_NOISE = 0.2;
/** Fracción del ruido que queda con el oído más fino. */
export const EAR_NOISE_FLOOR = 0.1;
/** Distancia a partir de la cual un acento deja de parecerse a uno conocido (es de otro lado). */
export const FAMILIAR_DISTANCE = 0.18;
/** Ruido de la voz al imitar, sin ninguna habilidad. */
export const MIMIC_NOISE = 0.12;
/** Distancia percibida (sobre la mínima notable) a la que el que finge levanta sospecha plena. */
export const SUSPICION_SPAN = 0.15;

/** El acento de una protovariante: cada rasgo sorteado. */
export function rootAccent(rng: Random): Accent {
  const out = {} as Record<AccentFeature, number>;
  for (const f of ACCENT_FEATURES) out[f] = rng.float();
  return out;
}

/**
 * La variante de una comunidad que se separó de otra: el acento del padre más una deriva por
 * rasgo que crece con las generaciones de separación (raíz cuadrada: la deriva es un paseo).
 */
export function deriveAccent(parent: Accent, rng: Random, generations: number): Accent {
  const sd = ACCENT_DRIFT * Math.sqrt(Math.max(0, generations));
  const out = {} as Record<AccentFeature, number>;
  for (const f of ACCENT_FEATURES) out[f] = clamp01(parent[f] + rng.normal(0, sd));
  return out;
}

/** Distancia entre dos acentos: la diferencia media por rasgo (0-1). */
export function accentDistance(a: Accent, b: Accent): number {
  let sum = 0;
  for (const f of ACCENT_FEATURES) sum += Math.abs(a[f] - b[f]);
  return sum / ACCENT_FEATURES.length;
}

/**
 * El acento medio de quien imita `target` con su faceta `skill` (0-1): con 1 es el del otro, con 0
 * el propio. Sin ruido; el temblor de una emisión concreta es `utterAccent`.
 */
export function spokenAccent(native: Accent, target: Accent, skill: number): Accent {
  const s = clamp01(skill);
  const out = {} as Record<AccentFeature, number>;
  for (const f of ACCENT_FEATURES) out[f] = target[f] + (native[f] - target[f]) * (1 - s);
  return out;
}

/**
 * Una emisión concreta: el acento hablado más el temblor de la voz, que crece con la falta de
 * habilidad y con la tensión (`strain` 0-1: cansancio, miedo, enojo). Quien habla su acento
 * nativo (nada que sostener) no tiembla.
 */
export function utterAccent(
  native: Accent,
  target: Accent,
  skill: number,
  strain: number,
  rng: Random,
): Accent {
  const mean = spokenAccent(native, target, skill);
  const imitating = accentDistance(native, target) > 0;
  const sd = imitating ? MIMIC_NOISE * (1 - clamp01(skill)) * (1 + clamp01(strain)) : 0;
  const out = {} as Record<AccentFeature, number>;
  for (const f of ACCENT_FEATURES) out[f] = clamp01(mean[f] + (sd > 0 ? rng.normal(0, sd) : 0));
  return out;
}

/** Lo que oye un oído con la habilidad `ear` (0-1): la emisión más el ruido de percibirla. */
export function perceiveAccent(heard: Accent, ear: number, rng: Random): Accent {
  const sd = EAR_NOISE * (1 - (1 - EAR_NOISE_FLOOR) * clamp01(ear));
  const out = {} as Record<AccentFeature, number>;
  for (const f of ACCENT_FEATURES) out[f] = clamp01(heard[f] + rng.normal(0, sd));
  return out;
}

export interface KnownAccent<C extends string = string> {
  readonly community: C;
  readonly accent: Accent;
}

export interface OriginGuess<C extends string = string> {
  /** La comunidad más parecida entre las que el oyente conoce (nunca una que no conoce). */
  readonly nearest: C | undefined;
  readonly distance: number;
  /** ¿Se parece lo bastante a la conocida como para decir "es de ahí"? Si no, "no es de por acá". */
  readonly recognized: boolean;
  /** 0-1: qué tan clara fue la ventaja sobre la segunda candidata. */
  readonly confidence: number;
}

/**
 * De dónde es el que habla, según lo que el oyente sabe: compara lo percibido con los acentos de
 * las comunidades que conoce. Fuera de lo conocido no puede nombrar el origen (solo "no es de acá").
 */
export function identifyOrigin<C extends string>(
  perceived: Accent,
  known: readonly KnownAccent<C>[],
): OriginGuess<C> {
  let best: KnownAccent<C> | undefined;
  let bestD = Number.POSITIVE_INFINITY;
  let second = Number.POSITIVE_INFINITY;
  for (const k of known) {
    const d = accentDistance(perceived, k.accent);
    if (d < bestD || (d === bestD && best && k.community < best.community)) {
      second = bestD;
      bestD = d;
      best = k;
    } else if (d < second) second = d;
  }
  if (!best) return { nearest: undefined, distance: 1, recognized: false, confidence: 0 };
  const gap = Number.isFinite(second) ? second - bestD : FAMILIAR_DISTANCE;
  return {
    nearest: best.community,
    distance: bestD,
    recognized: bestD <= FAMILIAR_DISTANCE,
    confidence: clamp01(gap / FAMILIAR_DISTANCE),
  };
}

export interface FakeJudgment {
  /** 0-1: cuánto desentona lo oído con el acento que dice tener. */
  readonly suspicion: number;
  readonly detected: boolean;
}

/**
 * ¿Suena falso? El oyente compara lo que percibe con el acento que el hablante dice tener. Un oído
 * grueso deja pasar diferencias que uno fino no; la sospecha es la distancia percibida pasada la
 * diferencia mínima notable, y se detecta con una tirada sobre ella.
 */
export function judgeFake(heard: Accent, claimed: Accent, ear: number, rng: Random): FakeJudgment {
  const perceived = perceiveAccent(heard, ear, rng);
  const d = accentDistance(perceived, claimed);
  const suspicion = clamp01((d - ACCENT_JND) / SUSPICION_SPAN);
  return { suspicion, detected: rng.chance(suspicion) };
}
