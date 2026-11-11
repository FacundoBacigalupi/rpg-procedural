// La membresía (novel-cult-sect-join-member, organizations §3): el aceptado en la prueba queda
// discípulo externo de la secta. Los emisarios le dicen dónde queda la sede y hasta cuándo tiene para
// presentarse: esa citación la cree exacta (rumbo y jornadas de la verdad, sin el error de lo oído).
// Subir a la sede es jugar fuera del parche de la aldea (`novel-sect-seat`); hasta entonces el
// miembro sigue en su casa, sabiéndose de la secta.

import type { EntityRef, Tick } from "../../core/index.ts";
import { table } from "../world/index.ts";
import { compassOf, type Sect, type SectLore, WALK_KM_PER_DAY } from "./sect.ts";

export const SECT_JOINED_EVENT = "cultivation.sect_joined";

/** Cuántos días le dan al aceptado para presentarse en la sede. */
export const SECT_REPORT_DAYS = 30;

/** Externo (el aceptado en la aldea), interno (discípulo de la sede), anciano y maestro. */
export type MemberRank = "outer" | "inner" | "elder" | "master";

/** Que alguien es de una secta: desde cuándo, con qué rango y hasta cuándo tiene para subir. */
export interface SectMember {
  readonly org: EntityRef;
  readonly rank: MemberRank;
  readonly since: Tick;
  /** El año de la prueba que lo aceptó (los de la sede no pasaron por la de la aldea). */
  readonly trialYear?: number;
  /** Hasta cuándo tiene para presentarse en la sede (lo sabe: se lo dijeron). */
  readonly reportBy?: Tick;
}

export const SECT_MEMBER = table<SectMember>("cultivation.sect_member");

/** La citación: lo que le dicen al aceptado de la sede, exacto, sobre lo que ya creía. */
export function summonedLore(
  before: SectLore | undefined,
  org: EntityRef,
  sect: Sect,
  now: Tick,
): SectLore {
  return {
    ...before,
    org,
    seat: sect.seatPlace,
    bearing: compassOf(sect.seat.bearingDeg),
    days: Math.max(1, Math.round(sect.seat.km / WALK_KM_PER_DAY)),
    confidence: 1,
    learnedAt: before?.learnedAt ?? now,
  };
}

/** Las tareas de discípulo en la sede (novel-sect-duty-chore, organizations §6). */
export type SectChore = "sweep" | "guard" | "firewood";

export const SECT_CHORE_EVENT = "cultivation.sect_chore";

/** Cuántos puntos da una hora de tarea bien hecha (sin calibrar). */
export const CHORE_POINTS_PER_HOUR = 1;

/**
 * Los puntos de contribución de un miembro: un derecho contra la secta, no una cosa (organizations
 * §6). Se ganan con tareas y, cuando haya con qué, se canjean contra el tesoro.
 */
export interface SectContribution {
  readonly org: EntityRef;
  readonly points: number;
  /** Las horas de tarea que se le anotaron, en total. */
  readonly hours: number;
  /** La última vez que se le anotó algo. */
  readonly last: Tick;
}

export const SECT_CONTRIBUTION = table<SectContribution>("cultivation.sect_contribution");

/** El sueldo del mes desde el tesoro de la secta (novel-sect-duty-stipend). */
export const SECT_STIPEND_EVENT = "cultivation.sect_stipend";
/** Cada cuántos días se paga el sueldo. */
export const STIPEND_EVERY_DAYS = 30;
/** El sueldo de cada rango en cobre por mes (sin calibrar). */
export const STIPEND_BY_RANK: Readonly<Record<MemberRank, number>> = {
  outer: 30,
  inner: 60,
  elder: 150,
  master: 300,
};

/**
 * Lo que recibe cada uno si en el tesoro hay `have`: lo pedido si alcanza; si no, todos recortados
 * por la misma fracción (hacia abajo, en cobre entero), así nunca sale más de lo que hay.
 */
export function stipendShares(
  want: readonly number[],
  have: number,
): { readonly shares: readonly number[]; readonly ratio: number } {
  const total = want.reduce((a, b) => a + b, 0);
  if (total <= have) return { shares: want, ratio: 1 };
  const ratio = total > 0 ? Math.max(0, have) / total : 0;
  return { shares: want.map((x) => Math.floor(x * ratio)), ratio: Math.round(ratio * 100) / 100 };
}

/** Qué tarea es: la que dice quien la hace («barro», «hago guardia», «leña») o la del lugar. */
export function choreOf(said: string | undefined, space: string | undefined): SectChore {
  const s = (said ?? "").toLowerCase();
  if (/barr|limpi|escoba/.test(s)) return "sweep";
  if (/guardia|vigil|porton|portón/.test(s)) return "guard";
  if (/leña|lena/.test(s)) return "firewood";
  if (space?.endsWith("/gate")) return "guard";
  if (space?.startsWith("sect:")) return "sweep";
  return "firewood";
}

/**
 * Los puntos que da una tarea según cuánto duró y cómo salió (a medias, la mitad; mal, nada). El
 * resultado excepcional cuenta según el signo del margen.
 */
export function chorePoints(hours: number, outcome: string | undefined, margin = 0): number {
  const good =
    outcome === "success" || outcome === "discovered" || (outcome === "critical" && margin > 0);
  const k = good ? 1 : outcome === "partial" ? 0.5 : 0;
  return Math.round(hours * CHORE_POINTS_PER_HOUR * k * 100) / 100;
}
