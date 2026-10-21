// Desarrollo por etapas y apego (npc-psychology §10). Núcleo puro, opt-in y sin cablear: nadie lo
// llama todavía, así que no cambia estado ni hashes. La etapa la marca la edad vivida (`stageAt`),
// cada paso de etapa lleva el evento que lo causó, y el apego es un resumen cacheado de los
// esquemas de infancia (nunca una variable suelta que se escriba a mano).

import type { EventId, Tick } from "../../core/index.ts";
import { type Mind, type StageDef, stageAt } from "./mind.ts";

export type AttachmentStyle = "secure" | "anxious" | "avoidant" | "disorganized";

export interface DevelopmentState {
  readonly stage: string;
  readonly stageEnteredAt: Tick;
  /** El rito cultural que marcó el paso a esta etapa, si lo hubo. */
  readonly riteOfPassage?: EventId;
  readonly attachment: AttachmentStyle;
  /** Eventos de alto impacto vividos en un período sensible (los últimos `MAX_FORMATIVE_DEV`). */
  readonly formativeEvents: readonly EventId[];
  /** El evento con que empezó este estado (nacimiento o siembra). */
  readonly originEventId: EventId;
}

export const MAX_FORMATIVE_DEV = 24;
/** Fuerza desde la que un esquema de infancia cuenta como «alto» para el apego. */
export const ATTACHMENT_HIGH = 0.5;

/** Esquemas de infancia de los que se deriva el apego (§10: cuidado confiable, valía propia). */
export const ATTACHMENT_SCHEMAS = {
  distrust: "people_are_untrustworthy",
  unworthy: "i_am_unworthy",
} as const;

/**
 * Apego derivado de los esquemas: desconfiar de los demás sin sentirse indigno es evitativo;
 * sentirse indigno confiando en los demás es ansioso; ambos, desorganizado; ninguno, seguro.
 */
export function attachmentFromMind(mind: Pick<Mind, "schemas">): AttachmentStyle {
  const distrust = (mind.schemas[ATTACHMENT_SCHEMAS.distrust]?.strength ?? 0) >= ATTACHMENT_HIGH;
  const unworthy = (mind.schemas[ATTACHMENT_SCHEMAS.unworthy]?.strength ?? 0) >= ATTACHMENT_HIGH;
  if (distrust && unworthy) return "disorganized";
  if (distrust) return "avoidant";
  if (unworthy) return "anxious";
  return "secure";
}

/** Cómo tiñe el apego la lectura de los cercanos y la formación de relaciones (§3, §6). */
export interface AttachmentBias {
  /** Se suma a la confianza inicial en alguien nuevo (-1 a 1). */
  readonly trustPrior: number;
  /** Multiplica cuánto pesa un acto ambiguo del cercano leído como amenaza (1: neutro). */
  readonly threatReading: number;
  /** Multiplica la velocidad con que se afloja un lazo cercano (1: neutro). */
  readonly closeness: number;
}

/** Calibración abierta: valores de arranque, no medidos. */
export const ATTACHMENT_BIAS: Readonly<Record<AttachmentStyle, AttachmentBias>> = {
  secure: { trustPrior: 0.1, threatReading: 0.8, closeness: 1.1 },
  anxious: { trustPrior: 0.05, threatReading: 1.4, closeness: 1.3 },
  avoidant: { trustPrior: -0.15, threatReading: 1.1, closeness: 0.6 },
  disorganized: { trustPrior: -0.2, threatReading: 1.6, closeness: 0.9 },
};

/** Inclinación al riesgo y peso de los pares por etapa (calibración abierta). */
export const STAGE_SOCIAL: Readonly<Record<string, { riskBias: number; peerWeight: number }>> = {
  infancy: { riskBias: 0, peerWeight: 0.1 },
  childhood: { riskBias: 0.1, peerWeight: 0.3 },
  adolescence: { riskBias: 0.5, peerWeight: 0.8 },
  "young-adult": { riskBias: 0.3, peerWeight: 0.5 },
  adult: { riskBias: 0.1, peerWeight: 0.3 },
  elder: { riskBias: -0.2, peerWeight: 0.2 },
};
const SOCIAL_DEFAULT = { riskBias: 0, peerWeight: 0.3 } as const;

export const stageSocial = (stage: string) => STAGE_SOCIAL[stage] ?? SOCIAL_DEFAULT;

/** Estado inicial: la etapa de la edad vivida y el apego desde la mente. */
export function startDevelopment(
  stages: readonly StageDef[],
  ageYears: number,
  now: Tick,
  mind: Pick<Mind, "schemas">,
  origin: EventId,
): DevelopmentState {
  return {
    stage: stageAt(stages, ageYears).id,
    stageEnteredAt: now,
    attachment: attachmentFromMind(mind),
    formativeEvents: [],
    originEventId: origin,
  };
}

export interface StageTransition {
  readonly from: string;
  readonly to: string;
  readonly at: Tick;
  /** El evento que causó el paso (cumpleaños, rito, etc.); nada cambia de etapa «porque sí». */
  readonly cause: EventId;
}

/**
 * Avanza la etapa si la edad vivida ya cruzó el umbral. Devuelve el mismo estado si no cambió.
 * Una vez fijada, la etapa no retrocede aunque la edad dada sea menor (la vivida solo crece).
 * `rite` es el rito de paso que acompañó el cambio, si lo hubo.
 */
export function advanceStage(
  state: DevelopmentState,
  stages: readonly StageDef[],
  ageYears: number,
  now: Tick,
  cause: EventId,
  rite?: EventId,
): { readonly state: DevelopmentState; readonly transition?: StageTransition } {
  const target = stageAt(stages, ageYears);
  const current = stages.find((s) => s.id === state.stage);
  if (target.id === state.stage || (current && target.fromAge < current.fromAge)) return { state };
  const { riteOfPassage: _old, ...rest } = state;
  const next: DevelopmentState = {
    ...rest,
    stage: target.id,
    stageEnteredAt: now,
    ...(rite ? { riteOfPassage: rite } : {}),
  };
  return { state: next, transition: { from: state.stage, to: target.id, at: now, cause } };
}

/** Si la etapa es sensible a este esquema, el evento queda como formativo. */
export function isSensitive(stage: StageDef, schema: string): boolean {
  return stage.sensitive.includes(schema);
}

/**
 * Registra un evento formativo (alto impacto en período sensible) y recalcula el apego desde la
 * mente ya formada. Conserva los más recientes, con duplicados fuera.
 */
export function recordFormative(
  state: DevelopmentState,
  mind: Pick<Mind, "schemas">,
  event: EventId,
): DevelopmentState {
  const events = state.formativeEvents.includes(event)
    ? state.formativeEvents
    : [...state.formativeEvents, event].slice(-MAX_FORMATIVE_DEV);
  return { ...state, formativeEvents: events, attachment: attachmentFromMind(mind) };
}

/**
 * Sin lugar (§10): pasó a la etapa sin rito de paso en una cultura que lo marca, déficit de
 * `belonging`. 0 si hubo rito o la etapa no lo exige.
 */
export function noPlaceDeficit(state: DevelopmentState, ritedStages: ReadonlySet<string>): number {
  return ritedStages.has(state.stage) && !state.riteOfPassage ? 1 : 0;
}

/** Problemas de coherencia del estado, para los invariantes. Vacío si está bien. */
export function developmentProblems(
  state: DevelopmentState,
  stages: readonly StageDef[],
): string[] {
  const out: string[] = [];
  if (!stages.some((s) => s.id === state.stage)) out.push(`etapa desconocida: ${state.stage}`);
  if (state.formativeEvents.length > MAX_FORMATIVE_DEV) out.push("demasiados eventos formativos");
  return out;
}
