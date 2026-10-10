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
  /** A quién dirige una respuesta que tiene autor identificado según el dueño. */
  readonly target?: AgentId;
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
  anger: 3 * 3600,
  joy: 8 * 3600,
  shame: 18 * 3600,
  envy: 48 * 3600,
  love: 14 * 24 * 3600,
} as const;

export interface InsultEmotionInput {
  readonly offender?: AgentId;
  /** Gravedad que el oyente ya juzgó en su ofensa, no la intención real del hablante. */
  readonly feltOffense: number;
  readonly delivered: boolean;
  readonly understood: boolean;
  readonly originEventId: EventId;
  readonly at: Tick;
}

/** Ira por un insulto comprendido que le dolió y cuyo autor pudo atribuir. No presume ira de tristeza/miedo. */
export function appraiseInsultEmotion(
  owner: AgentId,
  insult: InsultEmotionInput,
): EmotionSignal | undefined {
  const intensity = round(clamp01(insult.feltOffense));
  if (
    !insult.delivered ||
    !insult.understood ||
    insult.offender === undefined ||
    insult.offender === owner ||
    !Number.isFinite(intensity) ||
    intensity <= 0
  )
    return undefined;
  return {
    owner,
    emotion: "anger",
    intensity,
    originEventId: insult.originEventId,
    at: insult.at,
    appraisalTheme: "injustice",
    target: insult.offender,
  };
}

export interface ShameInput {
  /** Cara perdida que el dueño juzgó en el hecho (0-1). */
  readonly faceLoss: number;
  /** Si el dueño reconoce la falta como suya (verdad del insulto, tabú propio roto); sin eso es ira, no vergüenza. */
  readonly acknowledged: boolean;
  /** Testigos que el dueño cree que lo vieron. */
  readonly witnesses: number;
  readonly originEventId: EventId;
  readonly at: Tick;
}
/** Testigos creídos desde los que la exposición pesa por completo. */
export const SHAME_WITNESS_CAP = 4;
/** Fracción de la cara perdida que queda como vergüenza sin testigos. */
export const SHAME_PRIVATE_SHARE = 0.5;

/** Vergüenza por una falta propia reconocida; crece con los testigos que el dueño cree. No tiene objetivo. */
export function appraiseShameEmotion(owner: AgentId, i: ShameInput): EmotionSignal | undefined {
  const seen =
    Math.min(Math.max(0, Math.floor(i.witnesses)), SHAME_WITNESS_CAP) / SHAME_WITNESS_CAP;
  const intensity = round(
    clamp01(i.faceLoss) * (SHAME_PRIVATE_SHARE + (1 - SHAME_PRIVATE_SHARE) * seen),
  );
  if (!i.acknowledged || !Number.isFinite(intensity) || intensity <= 0) return undefined;
  return {
    owner,
    emotion: "shame",
    intensity,
    originEventId: i.originEventId,
    at: i.at,
    appraisalTheme: "failure",
  };
}

export interface EnvyInput {
  readonly rival?: AgentId | undefined;
  /** Ventaja del otro que el dueño percibió (0-1). */
  readonly perceivedGain: number;
  /** Confianza de esa lectura (0-1); lo mal leído pesa menos. */
  readonly confidence: number;
  /** Cuánto cree el dueño que le falta eso, frente al otro (0-1). */
  readonly gap: number;
  /** Cuánto le importa esa dimensión al dueño (0-1, de sus valores). */
  readonly valued: number;
  readonly originEventId: EventId;
  readonly at: Tick;
}

/** Envidia: el bien ajeno percibido, que el dueño valora y cree que le falta. Exige un rival distinto. */
export function appraiseEnvyEmotion(owner: AgentId, i: EnvyInput): EmotionSignal | undefined {
  const intensity = round(
    clamp01(i.perceivedGain) * clamp01(i.confidence) * clamp01(i.gap) * clamp01(i.valued),
  );
  if (i.rival === undefined || i.rival === owner || !Number.isFinite(intensity) || intensity <= 0)
    return undefined;
  return {
    owner,
    emotion: "envy",
    intensity,
    originEventId: i.originEventId,
    at: i.at,
    appraisalTheme: "failure",
    target: i.rival,
  };
}

export interface LoveInput {
  readonly beloved?: AgentId | undefined;
  /** Cariño que el dueño ya siente por la persona (0-1, su propia relación). */
  readonly affection: number;
  /** Calidez que percibió en el hecho (0-1). */
  readonly warmth: number;
  readonly confidence: number;
  readonly originEventId: EventId;
  readonly at: Tick;
}
/** Parte de la intensidad que pone el cariño previo; el resto, la calidez del momento. */
export const LOVE_AFFECTION_SHARE = 0.6;

/** Amor: cariño propio hacia alguien identificado, reavivado por calidez percibida. Sin cariño no nace. */
export function appraiseLoveEmotion(owner: AgentId, i: LoveInput): EmotionSignal | undefined {
  const affection = clamp01(i.affection);
  const intensity = round(
    affection *
      (LOVE_AFFECTION_SHARE + (1 - LOVE_AFFECTION_SHARE) * clamp01(i.warmth)) *
      clamp01(i.confidence),
  );
  if (
    i.beloved === undefined ||
    i.beloved === owner ||
    !Number.isFinite(intensity) ||
    intensity <= 0
  )
    return undefined;
  return {
    owner,
    emotion: "love",
    intensity,
    originEventId: i.originEventId,
    at: i.at,
    appraisalTheme: "kindness",
    target: i.beloved,
  };
}

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
  success: "joy",
  kindness: "joy",
  blessing: "joy",
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
