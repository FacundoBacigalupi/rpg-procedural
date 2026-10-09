// Condiciones mentales persistentes con causa (npc-psychology §11): el trauma y la culpa que deja
// matar (`combat/aftermath.ts`) no son un número suelto en los esquemas, son condiciones que duran,
// ceden con el tiempo y el apoyo, y se notan: pesadillas al dormir. Cada una guarda el evento que
// la abrió y su disparador (el rival, el lugar). Funciones puras; el proceso de la vida las aplica.

import {
  type AgentId,
  type EventId,
  type PlaceRef,
  placeKey,
  pow,
  type Tick,
} from "../../core/index.ts";
import { table } from "../world/index.ts";
import { type FormativeStimulus, PAINFUL } from "./mind.ts";

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const round = (x: number) => Math.round(x * 1e6) / 1e6;

export type ConditionKind = "trauma" | "guilt";

/** Lo que la despierta de golpe: ver de nuevo a alguien o volver al lugar. */
export interface ConditionTrigger {
  readonly who?: AgentId;
  readonly place?: PlaceRef;
}

export interface MentalCondition {
  readonly kind: ConditionKind;
  /** 0-1. */
  readonly severity: number;
  readonly originEventIds: readonly EventId[];
  readonly onset: Tick;
  readonly course: "acute" | "chronic" | "resolving";
  readonly triggers: readonly ConditionTrigger[];
}

export interface MentalState {
  readonly conditions: readonly MentalCondition[];
  /** Veces que mató (la costumbre embota, `killAftermath.priorKills`). */
  readonly kills: number;
  /** Hasta cuándo está aplicado el paso del tiempo. */
  readonly updated: Tick;
  readonly originEventId: EventId;
}

export const MENTAL = table<MentalState>("mind.conditions");

/** Días para que una condición pierda la mitad, sin apoyo (calibración abierta). */
export const CONDITION_HALF_LIFE_DAYS = { trauma: 90, guilt: 200 } as const;
/** Bajo esta gravedad la condición se resuelve y se borra. */
export const CONDITION_FLOOR = 0.03;
/** Cuántas condiciones de cada tipo guarda como máximo (las causas se juntan). */
export const MAX_ORIGINS = 8;
/** Chance de pesadilla por noche = gravedad × esto. */
export const NIGHTMARE_RATE = 0.8;
/** Gravedad desde la que el curso es crónico. */
export const CHRONIC_FROM = 0.5;

export const emptyMental = (origin: EventId, now: Tick): MentalState => ({
  conditions: [],
  kills: 0,
  updated: now,
  originEventId: origin,
});

const courseOf = (severity: number): MentalCondition["course"] =>
  severity >= CHRONIC_FROM ? "chronic" : severity >= 0.15 ? "acute" : "resolving";

/**
 * Suma una vivencia a la condición del mismo tipo (las gravedades se combinan sin pasar de 1) o abre
 * una nueva. Cita siempre el evento que la causó.
 */
export function openCondition(
  state: MentalState,
  kind: ConditionKind,
  severity: number,
  cause: EventId,
  trigger: ConditionTrigger,
  now: Tick,
): MentalState {
  const s = clamp01(severity);
  if (s < CONDITION_FLOOR) return state;
  const old = state.conditions.find((c) => c.kind === kind);
  const merged: MentalCondition = old
    ? {
        ...old,
        severity: round(1 - (1 - old.severity) * (1 - s)),
        originEventIds: [...old.originEventIds, cause].slice(-MAX_ORIGINS),
        triggers: [...old.triggers, trigger].slice(-MAX_ORIGINS),
        course: courseOf(1 - (1 - old.severity) * (1 - s)),
      }
    : {
        kind,
        severity: round(s),
        originEventIds: [cause],
        onset: now,
        course: courseOf(s),
        triggers: [trigger],
      };
  return {
    ...state,
    conditions: [...state.conditions.filter((c) => c.kind !== kind), merged].sort((a, b) =>
      a.kind < b.kind ? -1 : 1,
    ),
  };
}

/** El tiempo cura: cada condición decae a su vida media; el apoyo (0-1) acelera la cura. */
export function settleConditions(
  state: MentalState,
  now: Tick,
  dayLength: number,
  support: number | ((kind: ConditionKind) => number) = 0,
): MentalState {
  const days = Math.max(0, (now - state.updated) / dayLength);
  if (days === 0) return state;
  const conditions = state.conditions.flatMap((c) => {
    const s = typeof support === "number" ? support : support(c.kind);
    const half = CONDITION_HALF_LIFE_DAYS[c.kind] / (1 + clamp01(s));
    const severity = round(c.severity * pow(0.5, days / half));
    return severity < CONDITION_FLOOR
      ? []
      : [{ ...c, severity, course: courseOf(severity) } satisfies MentalCondition];
  });
  return { ...state, conditions, updated: now };
}

/** Gravedad de una condición (0 si no la tiene). */
export function severityOf(state: MentalState | undefined, kind: ConditionKind): number {
  return state?.conditions.find((c) => c.kind === kind)?.severity ?? 0;
}

/** Chance de pesadilla esa noche: la peor condición manda (el trauma pesa más que la culpa). */
export function nightmareChance(state: MentalState | undefined): number {
  if (!state) return 0;
  return clamp01(
    NIGHTMARE_RATE *
      Math.max(0, ...state.conditions.map((c) => c.severity * (c.kind === "trauma" ? 1 : 0.6))),
  );
}

/** Cuánto pesa cada tipo al evitar o al invadir (el trauma más que la culpa). */
const KIND_WEIGHT = { trauma: 1, guilt: 0.6 } as const;
/** Tope de la evitación: nunca anula del todo la utilidad de acercarse. */
export const AVOIDANCE_CAP = 0.9;
/** Chance de un recuerdo intrusivo al toparse con el disparador = gravedad × esto. */
export const INTRUSION_RATE = 0.7;

/** Lo que el personaje tiene delante: una persona, un lugar o ambos. */
export interface ConditionCue {
  readonly who?: AgentId;
  readonly place?: PlaceRef;
}

const samePlace = (a: PlaceRef | undefined, b: PlaceRef | undefined) =>
  a !== undefined && b !== undefined && placeKey(a) === placeKey(b);

/** Las condiciones que el estímulo despierta: alguno de sus disparadores coincide en persona o lugar. */
export function triggeredBy(
  state: MentalState | undefined,
  cue: ConditionCue,
): readonly MentalCondition[] {
  if (!state) return [];
  return state.conditions.filter((c) =>
    c.triggers.some(
      (t) =>
        (t.who !== undefined && t.who === cue.who) ||
        (t.place !== undefined && samePlace(t.place, cue.place)),
    ),
  );
}

/**
 * Evitación (0-1): cuánto castiga la utilidad acercarse al estímulo. Manda la condición más pesada
 * entre las que dispara; con tope (`AVOIDANCE_CAP`) para que la valentía o la necesidad aún puedan más.
 */
export function avoidance(state: MentalState | undefined, cue: ConditionCue): number {
  const worst = Math.max(
    0,
    ...triggeredBy(state, cue).map((c) => c.severity * KIND_WEIGHT[c.kind]),
  );
  return round(Math.min(AVOIDANCE_CAP, worst));
}

/** Aplica la evitación a un valor de utilidad o saliencia positivo de acercarse al estímulo. */
export const avoided = (value: number, avoid: number): number =>
  round(value * (1 - clamp01(avoid)));

/** Chance de que el estímulo traiga un recuerdo intrusivo. */
export function intrusionChance(state: MentalState | undefined, cue: ConditionCue): number {
  const worst = Math.max(
    0,
    ...triggeredBy(state, cue).map((c) => c.severity * KIND_WEIGHT[c.kind]),
  );
  return round(clamp01(INTRUSION_RATE * worst));
}

/** Los eventos que un recuerdo intrusivo trae de vuelta: los que abrieron las condiciones despertadas. */
export function intrusionEvents(state: MentalState | undefined, cue: ConditionCue): EventId[] {
  return [...new Set(triggeredBy(state, cue).flatMap((c) => c.originEventIds))].sort();
}

/** Cuánto sube la atención con hipervigilancia máxima (multiplicador = 1 + esto × vigilancia). */
export const VIGILANCE_ATTENTION_GAIN = 0.5;
/** Tope de la atención resultante (la agudeza de mirar a propósito ya llega a 2). */
export const VIGILANCE_ATTENTION_CAP = 1.5;
/** Cuánto del miedo de dormir pone la hipervigilancia máxima (duerme con un oído abierto). */
export const VIGILANCE_SLEEP_FEAR = 0.5;
/** Chance de falsa alarma por mirada = vigilancia × esto. */
export const FALSE_ALARM_RATE = 0.2;
/** Cuánto embota cada tipo las emociones positivas (el trauma apaga; la culpa casi no). */
const NUMBING_WEIGHT = { trauma: 0.8, guilt: 0.2 } as const;
/** Tope del entumecimiento: nunca anula del todo lo que se siente. */
export const NUMBING_CAP = 0.8;

/** Hipervigilancia (0-1): el trauma deja al cuerpo en guardia; la culpa no. */
export function hypervigilance(state: MentalState | undefined): number {
  return round(clamp01(severityOf(state, "trauma")));
}

/** La atención de quien mira, subida por la hipervigilancia (sin tocar al dormido). */
export function vigilantAttention(attention: number, state: MentalState | undefined): number {
  const v = hypervigilance(state);
  if (v === 0 || attention <= 0.1) return attention;
  const raised = Math.min(VIGILANCE_ATTENTION_CAP, attention * (1 + VIGILANCE_ATTENTION_GAIN * v));
  return round(Math.max(attention, raised));
}

/** Miedo de fondo al dormir por estar en guardia (0-1), para la calidad del sueño. */
export function vigilantSleepFear(state: MentalState | undefined): number {
  return round(VIGILANCE_SLEEP_FEAR * hypervigilance(state));
}

/** Chance de que lo ambiguo se lea como amenaza (falso positivo) en una mirada. */
export function falseAlarmChance(state: MentalState | undefined): number {
  return round(clamp01(FALSE_ALARM_RATE * hypervigilance(state)));
}

/** Entumecimiento (0-1, con tope): cuánto se apagan las emociones positivas. */
export function numbing(state: MentalState | undefined): number {
  if (!state) return 0;
  const worst = Math.max(0, ...state.conditions.map((c) => c.severity * NUMBING_WEIGHT[c.kind]));
  return round(Math.min(NUMBING_CAP, worst));
}

/** Intensidad de una vivencia tras el entumecimiento: solo baja la de valencia positiva. */
export function numbedIntensity(
  intensity: number,
  valence: number,
  state: MentalState | undefined,
): number {
  return valence > 0 ? round(intensity * (1 - numbing(state))) : intensity;
}

/**
 * Un estímulo formativo tras el entumecimiento: lo bueno (cuidado, éxito, bendición…) deja menos marca
 * en los esquemas; lo doloroso entra entero. Así el ánimo de `mind.form` también se apaga.
 */
export function numbedStimulus(
  stimulus: FormativeStimulus,
  state: MentalState | undefined,
): FormativeStimulus {
  if (PAINFUL.has(stimulus.theme)) return stimulus;
  return { ...stimulus, intensity: round(stimulus.intensity * (1 - numbing(state))) };
}

/** La utilidad de algo placentero (comer rico, descansar, gustar) tras el entumecimiento. */
export function pleasureUtility(value: number, state: MentalState | undefined): number {
  return value > 0 ? round(value * (1 - numbing(state))) : value;
}

/** Las causas de lo que se sueña:los eventos que abrieron las condiciones que pesan. */
export function nightmareCauses(state: MentalState | undefined): EventId[] {
  if (!state) return [];
  return [...new Set(state.conditions.flatMap((c) => c.originEventIds))].sort();
}
