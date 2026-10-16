// Intrigas F1 (schemes §1, §2, §3, §8): asesinato y robo directos motivados por un objetivo, sin
// modelo de la víctima. El intrigante decide con *lo que cree* (fuerza del blanco, testigos,
// cuánto le debe) y sus rasgos; el plan es un camino corto de pasos cuyo largo lo acota el
// intelecto (bajo: 1-2 pasos, "que la maten esta noche"). Cada paso registrado lleva `causes`
// hacia el paso anterior y al `originEventId` del plan; nunca se le pasa al narrador.
//
// Todo puro: sin IO ni reloj; la aleatoriedad llega por el `Random` que pasa el llamador.

import type { AgentId, EventId, Random, SchemeId, Tick } from "../../core/index.ts";

const round6 = (x: number): number => Math.round(x * 1e6) / 1e6;
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

export type SchemeMotive =
  | "greed"
  | "rival"
  | "position"
  | "obstacle"
  | "revenge"
  | "commission"
  | "prevention";

export type SchemeMethod = "murder" | "theft";

export type SchemeStatus =
  | "preparing"
  | "active"
  | "succeeded"
  | "failed"
  | "abandoned"
  | "exposed";

export type SchemeStepKind = "scout" | "wait" | "approach" | "strike" | "take" | "flee" | "hide";

export interface SchemeStep {
  readonly kind: SchemeStepKind;
}

/** La verdad de una intriga F1. No tiene `targetModel` ni ramas todavía (F3). */
export interface Scheme {
  readonly id: SchemeId;
  readonly owner: AgentId;
  readonly target: AgentId;
  readonly motive: SchemeMotive;
  readonly method: SchemeMethod;
  readonly steps: readonly SchemeStep[];
  /** Cuántos pasos ya se hicieron. */
  readonly done: number;
  readonly status: SchemeStatus;
  readonly originEventId: EventId;
  readonly startedAt: Tick;
  /** Eventos que produjo, en orden. */
  readonly log: readonly EventId[];
}

/** Lo que el intrigante cree y es; todo 0-1 salvo `affinity`. Nada de esto es la verdad del blanco. */
export interface SchemerView {
  /** Qué tanto empuja el objetivo que da el motivo. */
  readonly motiveStrength: number;
  readonly motive: SchemeMotive;
  readonly boldness: number;
  /** Baja = frío con los demás. */
  readonly warmth: number;
  /** Lo frena la honra. */
  readonly honor: number;
  /** Miedo al karma o al castigo. */
  readonly fear: number;
  readonly intellect: number;
  /** Lo que cree de la fuerza del blanco respecto de la propia (0 mucho más débil, 1 mucho más fuerte). */
  readonly believedTargetStrength: number;
  /** Lo que cree que el blanco posee y vale la pena llevarse. */
  readonly believedLoot: number;
  /** Probabilidad que cree de que lo vean. */
  readonly believedWitnesses: number;
  /** Afecto por el blanco (-1 a 1). */
  readonly affinity: number;
}

export interface SchemeDecision {
  readonly scheme: boolean;
  readonly method: SchemeMethod | null;
  /** Mejor utilidad de tramar (con el ruido de la decisión). */
  readonly net: number;
  readonly utilityMurder: number;
  readonly utilityTheft: number;
}

/** Umbral de utilidad neta para que el motivo pase a intriga (sin calibrar). */
export const SCHEME_THRESHOLD = 0.15;
/** Amplitud del ruido de la decisión (sin calibrar). */
export const SCHEME_JITTER = 0.05;

/** Cuánto sirve matar según el motivo. */
const KILL_FIT: Readonly<Record<SchemeMotive, number>> = {
  greed: 0.3,
  rival: 0.7,
  position: 0.6,
  obstacle: 0.8,
  revenge: 1,
  commission: 0.7,
  prevention: 0.8,
};
/** Cuánto sirve robar según el motivo. */
const LOOT_FIT: Readonly<Record<SchemeMotive, number>> = {
  greed: 1,
  rival: 0.1,
  position: 0.2,
  obstacle: 0.2,
  revenge: 0.4,
  commission: 0.5,
  prevention: 0.1,
};

/**
 * Decide si el motivo se vuelve intriga y con qué método (schemes §1: depende de la utilidad,
 * `boldness`, `warmth` baja, honra y miedo). Mide contra lo que cree del blanco.
 */
export function decideScheme(v: SchemerView, rng: Random): SchemeDecision {
  const brake = 0.5 * v.honor + 0.5 * v.fear;
  const gall = 0.6 * v.boldness + 0.4 * (1 - v.warmth);
  const risk = clamp01(0.6 * v.believedTargetStrength + 0.4 * v.believedWitnesses);
  const love = Math.max(0, v.affinity);
  const base = v.motiveStrength * gall - brake * 0.6 - risk * 0.4;
  const uMurder = round6(base * KILL_FIT[v.motive] - 0.4 * love);
  const uTheft = round6(base * LOOT_FIT[v.motive] * (0.5 + 0.5 * v.believedLoot) - 0.2 * love);
  const jitter = (rng.float() - 0.5) * 2 * SCHEME_JITTER;
  const method: SchemeMethod = uMurder >= uTheft ? "murder" : "theft";
  const net = round6(Math.max(uMurder, uTheft) + jitter);
  const go = net >= SCHEME_THRESHOLD;
  return {
    scheme: go,
    method: go ? method : null,
    net,
    utilityMurder: uMurder,
    utilityTheft: uTheft,
  };
}

/** Pasos del plan: el intelecto acota el largo (bajo 1, medio 4, alto 6). */
export function planSteps(method: SchemeMethod, intellect: number): readonly SchemeStep[] {
  const act: SchemeStepKind = method === "murder" ? "strike" : "take";
  let kinds: SchemeStepKind[];
  if (intellect < 0.34) kinds = [act];
  else if (intellect < 0.67) kinds = ["scout", "approach", act, "flee"];
  else kinds = ["scout", "wait", "approach", act, "flee", "hide"];
  return kinds.map((kind) => ({ kind }));
}

export function makeScheme(i: {
  readonly id: SchemeId;
  readonly owner: AgentId;
  readonly target: AgentId;
  readonly motive: SchemeMotive;
  readonly method: SchemeMethod;
  readonly intellect: number;
  readonly originEventId: EventId;
  readonly at: Tick;
}): Scheme {
  return {
    id: i.id,
    owner: i.owner,
    target: i.target,
    motive: i.motive,
    method: i.method,
    steps: planSteps(i.method, i.intellect),
    done: 0,
    status: "preparing",
    originEventId: i.originEventId,
    startedAt: i.at,
    log: [],
  };
}

/** Paso que toca, o null si el plan terminó. */
export function nextStep(s: Scheme): SchemeStep | null {
  if (s.status !== "preparing" && s.status !== "active") return null;
  return s.steps[s.done] ?? null;
}

/** Causas que debe llevar el evento del próximo paso: el paso anterior y el origen del plan. */
export function stepCauses(s: Scheme): readonly EventId[] {
  const last = s.log[s.log.length - 1];
  return last === undefined ? [s.originEventId] : [last, s.originEventId];
}

/** Registra el evento de un paso hecho. Al cumplir el último, el plan queda `succeeded`. */
export function recordStep(s: Scheme, eventId: EventId): Scheme {
  if (nextStep(s) === null) return s;
  const done = s.done + 1;
  return {
    ...s,
    done,
    log: [...s.log, eventId],
    status: done >= s.steps.length ? "succeeded" : "active",
  };
}

/** Cierra el plan antes de tiempo (falló, lo dejó o lo descubrieron); no pisa un éxito. */
export function endScheme(s: Scheme, status: "failed" | "abandoned" | "exposed"): Scheme {
  return s.status === "succeeded" || s.status === status ? s : { ...s, status };
}
