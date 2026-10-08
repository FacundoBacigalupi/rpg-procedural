// Condiciones mentales persistentes con causa (npc-psychology §11): el trauma y la culpa que deja
// matar (`combat/aftermath.ts`) no son un número suelto en los esquemas, son condiciones que duran,
// ceden con el tiempo y el apoyo, y se notan: pesadillas al dormir. Cada una guarda el evento que
// la abrió y su disparador (el rival, el lugar). Funciones puras; el proceso de la vida las aplica.

import { type AgentId, type EventId, type PlaceRef, pow, type Tick } from "../../core/index.ts";
import { table } from "../world/index.ts";

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
  support = 0,
): MentalState {
  const days = Math.max(0, (now - state.updated) / dayLength);
  if (days === 0) return state;
  const conditions = state.conditions.flatMap((c) => {
    const half = CONDITION_HALF_LIFE_DAYS[c.kind] / (1 + clamp01(support));
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

/** Las causas de lo que se sueña: los eventos que abrieron las condiciones que pesan. */
export function nightmareCauses(state: MentalState | undefined): EventId[] {
  if (!state) return [];
  return [...new Set(state.conditions.flatMap((c) => c.originEventIds))].sort();
}
