// Emociones transitorias con procedencia (npc-psychology §3-§4).
// Sólo interpreta appraisal propio ya producido; no recibe eventos de verdad ni lee otros NPC.
import {
  type AgentId,
  compareStrings,
  type EventId,
  exp,
  LN2,
  type Tick,
} from "../../core/index.ts";
import { table } from "../world/index.ts";
import type { Appraised } from "./appraise.ts";
import type { Theme } from "./mind.ts";

export const EMOTION_IDS = [
  "fear",
  "anger",
  "sadness",
  "joy",
  "shame",
  "guilt",
  "envy",
  "love",
] as const;
export type EmotionId = (typeof EMOTION_IDS)[number];

/** Una respuesta propia a un hecho interpretado, no una lectura de la emoción ajena. */
export interface EmotionSignal {
  readonly owner: AgentId;
  readonly emotion: EmotionId;
  readonly intensity: number;
  readonly originEventId: EventId;
  /** Momento en que lo vivió/interpretó, separado de la fecha del hecho narrado. */
  readonly at: Tick;
  readonly appraisalTheme: Theme;
  /** Sólo el cableado con evidencia propia agrega esta procedencia; no se rellena en historia legacy. */
  readonly evidence?: EmotionEvidence;
}

export type EmotionEvidence =
  | { readonly kind: "own"; readonly event: EventId }
  | { readonly kind: "percept"; readonly percept: string };
export interface Emotions {
  readonly signals: readonly EmotionSignal[];
}
export const EMOTIONS = table<Emotions>("mind.emotions");
export const MAX_EMOTION_SIGNALS = 24;
export const EMOTION_TRACE = 0.01;
/** Calibración provisional en ticks de la misma escala horaria que los insumos actuales. */
export const EMOTION_HALF_LIFE_TICKS = {
  fear: 6 * 3600,
  sadness: 24 * 3600,
  guilt: 12 * 3600,
} as const;

/** Reconcilia por dueño/emoción/hecho: no rejuvenece una respuesta repitiendo el evento. */
export function reconcileEmotionSignals(
  previous: readonly EmotionSignal[],
  next: readonly EmotionSignal[],
  now: Tick,
  reactivity: number,
): EmotionSignal[] {
  const key = (s: EmotionSignal) => `${s.owner}|${s.emotion}|${s.originEventId}`;
  const signals = new Map(previous.filter((s) => s.evidence !== undefined).map((s) => [key(s), s]));
  for (const signal of next) {
    if (signal.evidence === undefined) continue;
    const old = signals.get(key(signal));
    if (!old) signals.set(key(signal), signal);
  }
  return [...signals.values()]
    .filter((s) => {
      const halfLifeTicks =
        EMOTION_HALF_LIFE_TICKS[s.emotion as keyof typeof EMOTION_HALF_LIFE_TICKS];
      return (
        halfLifeTicks !== undefined &&
        emotionIntensityAt(s, now, { halfLifeTicks, reactivity }) >= EMOTION_TRACE
      );
    })
    .sort((a, b) => b.at - a.at || compareStrings(key(a), key(b)))
    .slice(0, MAX_EMOTION_SIGNALS);
}

/** Sólo estos appraisals existentes tienen una interpretación emocional implementada. */
const EMOTION_OF: Readonly<Partial<Record<Theme, EmotionId>>> = {
  violence: "fear",
  loss: "sadness",
  guilt: "guilt",
};
const round = (x: number) => Math.round(x * 1e6) / 1e6;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** El llamador debe aportar appraisal vivido/percibido por `owner` y su evento de procedencia.
 * Sin appraisal respaldado no nace una emoción. Repeticiones del mismo tema no suman intensidad.
 */
export function appraisalEmotionSignals(
  owner: AgentId,
  appraisal: readonly Appraised[],
  originEventId: EventId,
  at: Tick,
): EmotionSignal[] {
  const signals = new Map<EmotionId, EmotionSignal>();
  for (const a of appraisal) {
    const emotion = EMOTION_OF[a.stimulus.theme];
    const intensity = round(clamp01(a.stimulus.intensity));
    if (emotion === undefined || !Number.isFinite(intensity) || intensity <= 0) continue;
    const previous = signals.get(emotion);
    if (previous && previous.intensity >= intensity) continue;
    signals.set(emotion, {
      owner,
      emotion,
      intensity,
      originEventId,
      at,
      appraisalTheme: a.stimulus.theme,
    });
  }
  return [...signals.values()].sort((a, b) => compareStrings(a.emotion, b.emotion));
}

export interface EmotionDecay {
  /** Vida media en ticks para reactividad normalizada 0,5; cada integración decide su calibración. */
  readonly halfLifeTicks: number;
  /** 0-1; más reactividad prolonga la emoción (entre ×0,5 y ×1,5). */
  readonly reactivity: number;
}

/** Decaimiento perezoso determinista, separado de memoria episódica y condiciones crónicas. */
export function emotionIntensityAt(signal: EmotionSignal, now: Tick, decay: EmotionDecay): number {
  if (
    !(decay.halfLifeTicks > 0) ||
    !Number.isFinite(decay.halfLifeTicks) ||
    !Number.isFinite(decay.reactivity)
  )
    throw new RangeError("emotion decay needs finite reactivity and a positive finite half-life");
  if (now < signal.at) return 0;
  const halfLife = decay.halfLifeTicks * (0.5 + clamp01(decay.reactivity));
  return round(clamp01(signal.intensity) * exp((-LN2 * (now - signal.at)) / halfLife));
}
