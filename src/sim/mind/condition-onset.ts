// Cómo se abren el duelo y la depresión (npc-psychology §11): el duelo sale de perder a alguien con
// relación fuerte, según el modo de la muerte; se complica sin rito, con culpa, con pérdidas repetidas
// o sin apoyo, y entonces deriva en depresión. La depresión también sale de estrés crónico, pérdidas
// acumuladas y esquemas de indefensión. Funciones puras sobre `MentalState`; nadie las llama todavía.
// Constantes sin calibrar.

import type { AgentId, EventId, Tick } from "../../core/index.ts";
import {
  type ConditionTrigger,
  type MentalState,
  openCondition,
  severityOf,
} from "./conditions.ts";
import type { Mind } from "./mind.ts";

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const round = (x: number) => Math.round(x * 1e6) / 1e6;

/** Cómo fue la muerte: lo violento, lo sin cuerpo y lo que se pudo evitar pesan más. */
export interface LossMode {
  readonly violent?: boolean;
  /** No hubo cuerpo que velar (desaparecido, perdido en el mar). */
  readonly noBody?: boolean;
  /** El que sufre cree que pudo evitarlo. */
  readonly ownFault?: boolean;
}

export const GRIEF_MODE_GAIN = { violent: 0.25, noBody: 0.2, ownFault: 0.25 } as const;
/** Desde esta gravedad de duelo, complicado, deriva en depresión. */
export const GRIEF_TO_DEPRESSION_FROM = 0.35;
/** Fracción del duelo (por el factor de complicación) que pasa a depresión. */
export const GRIEF_TO_DEPRESSION_RATE = 0.7;
/** Con tanto apoyo (0-1) o más, la falta de apoyo no complica. */
export const SUPPORT_ENOUGH = 0.3;

/** Gravedad inicial del duelo: la relación (0-1) por el modo de la muerte, con tope 1. */
export function griefSeverity(bond: number, mode: LossMode = {}): number {
  const m =
    1 +
    (mode.violent ? GRIEF_MODE_GAIN.violent : 0) +
    (mode.noBody ? GRIEF_MODE_GAIN.noBody : 0) +
    (mode.ownFault ? GRIEF_MODE_GAIN.ownFault : 0);
  return round(clamp01(clamp01(bond) * 0.8 * m));
}

/** Abre (o suma) el duelo por la muerte de `who`; el disparador es esa persona. */
export function openGrief(
  state: MentalState,
  who: AgentId,
  bond: number,
  mode: LossMode,
  cause: EventId,
  now: Tick,
): MentalState {
  const trigger: ConditionTrigger = { who };
  return openCondition(state, "grief", griefSeverity(bond, mode), cause, trigger, now);
}

export interface GriefContext {
  /** Hubo rito de duelo de la cultura. */
  readonly riteHeld: boolean;
  /** Apoyo actual (0-1), el mismo que lee `settleConditions`. */
  readonly support: number;
}

/**
 * Qué tan complicado está el duelo (0-1): sin rito, con culpa, con pérdidas repetidas (más de un
 * evento de origen) o sin apoyo. 0 si no hay duelo.
 */
export function griefComplication(state: MentalState | undefined, ctx: GriefContext): number {
  const grief = state?.conditions.find((c) => c.kind === "grief");
  if (!state || !grief) return 0;
  let x = 0;
  if (!ctx.riteHeld) x += 0.35;
  if (severityOf(state, "guilt") > 0) x += 0.3;
  if (grief.originEventIds.length > 1) x += 0.2;
  if (ctx.support < SUPPORT_ENOUGH) x += 0.15;
  return round(clamp01(x));
}

/**
 * El duelo complicado deriva en depresión: si el duelo es grave y está complicado, abre depresión con
 * una parte de su gravedad, citando los eventos de la pérdida. Si no, el estado queda igual.
 */
export function complicateGrief(state: MentalState, ctx: GriefContext, now: Tick): MentalState {
  const grief = state.conditions.find((c) => c.kind === "grief");
  if (!grief || grief.severity < GRIEF_TO_DEPRESSION_FROM) return state;
  const factor = griefComplication(state, ctx);
  if (factor <= 0.3) return state;
  const cause = grief.originEventIds[grief.originEventIds.length - 1];
  if (cause === undefined) return state;
  return openCondition(
    state,
    "depression",
    grief.severity * factor * GRIEF_TO_DEPRESSION_RATE,
    cause,
    {},
    now,
  );
}

/** Lo que empuja a la depresión (todo 0-1). */
export interface DepressionPressure {
  /** Estrés crónico (promedio reciente de la tensión). */
  readonly chronicStress: number;
  /** Pérdidas acumuladas (duelos sin cerrar), normalizadas. */
  readonly losses: number;
  /** Dolor crónico o enfermedad que no cede. */
  readonly illness: number;
  /** Falta de sentido y aislamiento (déficit de pertenencia). */
  readonly isolation: number;
}

export const DEPRESSION_WEIGHTS = {
  chronicStress: 0.3,
  losses: 0.25,
  illness: 0.15,
  isolation: 0.2,
  helplessness: 0.3,
} as const;
/** Bajo esta presión total no se abre depresión. */
export const DEPRESSION_THRESHOLD = 0.35;

/**
 * Indefensión (0-1) desde los esquemas: `effort_pays` baja y `i_am_unworthy` alta la hacen subir
 * (esquemas `effort_is_useless`/`i_am_worthless` del doc, con los ids del contenido).
 */
export function helplessness(mind: Mind | undefined): number {
  if (!mind) return 0;
  const futile = 1 - (mind.schemas["effort_pays"]?.strength ?? 0.5);
  const unworthy = mind.schemas["i_am_unworthy"]?.strength ?? 0;
  return round(clamp01(0.5 * futile + 0.5 * unworthy));
}

/** Presión total hacia la depresión, 0-1 (suma ponderada; con tope). */
export function depressionPressure(p: DepressionPressure, mind: Mind | undefined): number {
  const w = DEPRESSION_WEIGHTS;
  return round(
    clamp01(
      w.chronicStress * clamp01(p.chronicStress) +
        w.losses * clamp01(p.losses) +
        w.illness * clamp01(p.illness) +
        w.isolation * clamp01(p.isolation) +
        w.helplessness * helplessness(mind),
    ),
  );
}

/**
 * Abre depresión si la presión supera el umbral; la gravedad es el exceso reescalado a 0-1. Cita el
 * evento que la dispara (la última pérdida, el diagnóstico, el fracaso). Sin disparador de lugar o
 * persona: la depresión no se despierta con un estímulo.
 */
export function openDepression(
  state: MentalState,
  pressure: DepressionPressure,
  mind: Mind | undefined,
  cause: EventId,
  now: Tick,
): MentalState {
  const total = depressionPressure(pressure, mind);
  if (total < DEPRESSION_THRESHOLD) return state;
  const severity = (total - DEPRESSION_THRESHOLD) / (1 - DEPRESSION_THRESHOLD);
  return openCondition(state, "depression", severity, cause, {}, now);
}
