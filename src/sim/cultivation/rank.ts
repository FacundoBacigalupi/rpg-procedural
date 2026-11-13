// Los ascensos de la sede para arriba (novel2-rank-core, organizations §4 y §6): de interno a núcleo y
// de núcleo a anciano. No los da la cuenta de horas (eso es de externo a interno, `promotionDue`):
// los decide alguien. En una secta el poder está concentrado (organizations §4.4): decide el maestro
// de la secta (o el anciano que manda si él no está) con su utilidad, y los ancianos presentes y el
// maestro del candidato lo influyen con lo que sienten por él. Primero los pisos del paso (tramo,
// aporte, tiempo en el rango) y el rencor; pasados, una tirada sobre la utilidad.
//
// Puro: el que decide no lee la verdad; recibe lo que sabe del candidato y lo que le dicen.

import { exp } from "../../core/index.ts";
import type { MemberRank } from "./member.ts";

/** Lo que pide la secta para pasar de un rango al siguiente (sin calibrar). */
export interface RankStep {
  readonly to: MemberRank;
  /** Umbrales del qi cruzados. */
  readonly stage: number;
  /** Puntos de contribución anotados. */
  readonly points: number;
  /** Días en el rango de ahora. */
  readonly days: number;
}

/** Los pasos que se deciden; los rangos que no están no suben por acá. */
export const RANK_STEPS: Readonly<Partial<Record<MemberRank, RankStep>>> = {
  inner: { to: "core", stage: 2, points: 120, days: 90 },
  core: { to: "elder", stage: 3, points: 300, days: 365 },
};

/** El paso que sigue a `rank`, si se decide uno. */
export const nextRank = (rank: MemberRank): RankStep | undefined => RANK_STEPS[rank];

/** Los pesos de la utilidad del que decide (sin calibrar). */
export const RANK_WEIGHTS = {
  talent: 0.3,
  surplus: 0.2,
  stage: 0.2,
  regard: 0.15,
  voices: 0.15,
} as const;
/** Dónde la utilidad da mitad y mitad, y cuán filosa es la tirada. */
export const RANK_BAR = 0.3;
export const RANK_TEMPERATURE = 0.1;
/** Por debajo de este trato, el que decide no lo sube aunque cumpla. */
export const RANK_GRUDGE = -0.3;
/** El peso de la voz del maestro del candidato frente a la de un anciano cualquiera. */
export const SPONSOR_WEIGHT = 2;

/** Una voz en la deliberación: cómo siente al candidato quien habla y cuánto pesa. */
export interface RankVoice {
  /** -1 a 1. */
  readonly regard: number;
  readonly weight: number;
}

/** Lo que el que decide sabe del candidato y lo que le dicen. */
export interface RankCase {
  readonly rank: MemberRank;
  readonly stage: number;
  readonly points: number;
  /** Días que lleva en el rango. */
  readonly days: number;
  /** El talento que le midió la prueba (0-1); sin prueba, nada. */
  readonly talent?: number;
  /** Cómo lo trata el que decide (-1 a 1). */
  readonly regard: number;
  /** Las voces de los demás (ancianos presentes, su maestro con más peso). */
  readonly voices: readonly RankVoice[];
}

export type RankRefusal = "top" | "too_soon" | "too_low" | "few_points" | "grudge" | "voted_down";

export type RankRuling =
  | {
      readonly kind: "promoted";
      readonly to: MemberRank;
      readonly score: number;
      readonly p: number;
    }
  | {
      readonly kind: "refused";
      readonly refused: RankRefusal;
      readonly score?: number;
      readonly p?: number;
    };

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const clamp11 = (x: number) => Math.min(1, Math.max(-1, x));
const round4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** Lo que dicen las voces, promediado por su peso (-1 a 1; sin voces, 0). */
export function voiceOf(voices: readonly RankVoice[]): number {
  let sum = 0;
  let weight = 0;
  for (const v of voices) {
    if (v.weight <= 0) continue;
    sum += v.weight * clamp11(v.regard);
    weight += v.weight;
  }
  return weight > 0 ? round4(sum / weight) : 0;
}

/**
 * La utilidad de subirlo, a ojos del que decide: talento, lo que aportó de más sobre el piso, los
 * tramos de más, su propio trato y lo que dicen los demás. Supone pasados los pisos.
 */
export function rankScore(c: RankCase, step: RankStep): number {
  const w = RANK_WEIGHTS;
  return round4(
    w.talent * clamp01(c.talent ?? 0) +
      w.surplus * clamp01((c.points - step.points) / step.points) +
      w.stage * clamp01(c.stage - step.stage) +
      w.regard * clamp11(c.regard) +
      w.voices * voiceOf(c.voices),
  );
}

/** La chance de que lo suba con esa utilidad (logística alrededor de `RANK_BAR`). */
export const rankChance = (score: number): number =>
  round4(1 / (1 + exp(-(score - RANK_BAR) / RANK_TEMPERATURE)));

/**
 * La decisión sobre el ascenso, con `draw` en [0, 1) del RNG del que decide. Por orden: si hay paso,
 * tiempo en el rango, tramo, aporte, rencor; después la tirada.
 */
export function judgeRankUp(c: RankCase, draw: number): RankRuling {
  const step = nextRank(c.rank);
  if (!step) return { kind: "refused", refused: "top" };
  if (c.days < step.days) return { kind: "refused", refused: "too_soon" };
  if (c.stage < step.stage) return { kind: "refused", refused: "too_low" };
  if (c.points < step.points) return { kind: "refused", refused: "few_points" };
  if (c.regard < RANK_GRUDGE) return { kind: "refused", refused: "grudge" };
  const score = rankScore(c, step);
  const p = rankChance(score);
  return draw < p
    ? { kind: "promoted", to: step.to, score, p }
    : { kind: "refused", refused: "voted_down", score, p };
}
