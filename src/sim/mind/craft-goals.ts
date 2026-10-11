// Metas de oficio y estudio (npc-psychology §7, f3d4d). Puro. Nacen de la práctica propia reciente
// (un registro de sesiones con su evento) y tienen final concreto: el próximo hito de nivel de esa
// habilidad. Se cumplen cuando el nivel alcanza el hito y hay varias sesiones propias que lo
// respaldan; el nivel mismo no basta, y un valor continuo nunca se cierra.

import { compareStrings, type Duration, type EventId, isId, type Tick } from "../../core/index.ts";
import type { GoalProgressEvidence } from "./goal-progress-evidence.ts";
import type { Goal } from "./goals.ts";

/** Una sesión de práctica propia: el evento del paso que la dejó asentada. */
export interface PracticeEntry {
  readonly skill: string;
  readonly event: EventId;
  readonly at: Tick;
  readonly hours: number;
}

export const CRAFT_GOAL_PREFIX = "medium:craft:";
/** Niveles que cierran una meta: competente, oficial, maestro (skills §2). */
export const CRAFT_MILESTONES = [0.25, 0.5, 0.75] as const;
/** Sesiones mínimas dentro de la ventana para que la práctica sea una meta y no un hecho suelto. */
export const CRAFT_MIN_SESSIONS = 3;
/** Cuánto aporta cada sesión recordada al progreso (hacen falta varias). */
export const CRAFT_SESSION_PROGRESS = 0.34;
/** Peso base de la meta; sube un poco con el nivel (más invertido, más importa). */
export const CRAFT_GOAL_WEIGHT = 0.3;

const r = (x: number) => Math.round(x * 1e6) / 1e6;

/** El primer hito por encima del nivel, o `undefined` si ya pasó el último. */
export function nextMilestone(level: number): number | undefined {
  return CRAFT_MILESTONES.find((m) => m > level);
}

export const craftGoalId = (skill: string, milestone: number): string =>
  `${CRAFT_GOAL_PREFIX}${skill}:${milestone}`;

/** `medium:craft:foraging:0.25` -> sus partes; `undefined` si no es una meta de oficio. */
export function parseCraftGoal(id: string): { skill: string; milestone: number } | undefined {
  if (!id.startsWith(CRAFT_GOAL_PREFIX)) return undefined;
  const rest = id.slice(CRAFT_GOAL_PREFIX.length);
  const cut = rest.lastIndexOf(":");
  if (cut <= 0) return undefined;
  const milestone = Number(rest.slice(cut + 1));
  return Number.isFinite(milestone) ? { skill: rest.slice(0, cut), milestone } : undefined;
}

const valid = (e: PracticeEntry, now: Tick): boolean =>
  Number.isSafeInteger(e.at) && e.at <= now && e.hours > 0 && isId("event", e.event);

/**
 * Metas de oficio: una por habilidad con al menos `CRAFT_MIN_SESSIONS` sesiones válidas dentro de
 * `window` y un hito por delante. El origen es la sesión más antigua de la ventana. `levels` es el
 * nivel que el propio agente cree tener (autoimagen), no el real.
 */
export function craftGoals(
  log: readonly PracticeEntry[],
  levels: Readonly<Record<string, number>>,
  now: Tick,
  window: Duration,
): Goal[] {
  const bySkill = new Map<string, PracticeEntry[]>();
  for (const e of log) {
    if (!valid(e, now) || e.at < now - window) continue;
    bySkill.set(e.skill, [...(bySkill.get(e.skill) ?? []), e]);
  }
  const out: Goal[] = [];
  for (const skill of [...bySkill.keys()].sort(compareStrings)) {
    const sessions = (bySkill.get(skill) ?? []).sort(
      (a, b) => a.at - b.at || compareStrings(a.event, b.event),
    );
    const level = levels[skill] ?? 0;
    const milestone = nextMilestone(level);
    const first = sessions[0];
    if (!first || milestone === undefined || sessions.length < CRAFT_MIN_SESSIONS) continue;
    out.push({
      id: craftGoalId(skill, milestone),
      layer: "medium",
      kind: "pursue",
      value: "knowledge",
      weight: r(Math.min(1, CRAFT_GOAL_WEIGHT + 0.2 * level)),
      originEventId: first.event,
      since: now,
    });
  }
  return out;
}

/**
 * Evidencia de que la meta se cumplió: solo si el nivel ya alcanzó el hito, cada sesión propia
 * posterior al nacimiento de la meta cuenta una vez. Antes del hito no hay evidencia.
 */
export function craftEvidence(
  goal: Goal,
  log: readonly PracticeEntry[],
  levels: Readonly<Record<string, number>>,
  now: Tick,
): GoalProgressEvidence[] {
  const parsed = parseCraftGoal(goal.id);
  if (!parsed || (levels[parsed.skill] ?? 0) < parsed.milestone) return [];
  return log
    .filter((e) => e.skill === parsed.skill && valid(e, now) && e.at >= goal.since)
    .map((e) => ({
      goalId: goal.id,
      cause: e.event,
      at: e.at,
      amount: CRAFT_SESSION_PROGRESS,
    }));
}
