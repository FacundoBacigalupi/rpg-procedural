// La membresía (novel-cult-sect-join-member, organizations §3): el aceptado en la prueba queda
// discípulo externo de la secta. Los emisarios le dicen dónde queda la sede y hasta cuándo tiene para
// presentarse: esa citación la cree exacta (rumbo y jornadas de la verdad, sin el error de lo oído).
// Subir a la sede es jugar fuera del parche de la aldea (`novel-sect-seat`); hasta entonces el
// miembro sigue en su casa, sabiéndose de la secta.

import type { EntityRef, Tick } from "../../core/index.ts";
import { isSectCave, type ReadonlyWorldTruth, table } from "../world/index.ts";
import { compassOf, SECT, type Sect, type SectLore, WALK_KM_PER_DAY } from "./sect.ts";

export const SECT_JOINED_EVENT = "cultivation.sect_joined";

/** Cuántos días le dan al aceptado para presentarse en la sede. */
export const SECT_REPORT_DAYS = 30;

/**
 * Externo (el aceptado en la aldea), interno (discípulo de la sede), del núcleo (el discípulo que la
 * secta eligió, novel2-rank-core), anciano y maestro.
 */
export type MemberRank = "outer" | "inner" | "core" | "elder" | "master";

/** Que alguien es de una secta: desde cuándo, con qué rango y hasta cuándo tiene para subir. */
export interface SectMember {
  readonly org: EntityRef;
  readonly rank: MemberRank;
  readonly since: Tick;
  /** Desde cuándo tiene el rango de ahora (sin esto, desde `since`; novel2-rank-ask). */
  readonly rankSince?: Tick;
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

/**
 * El pase a la cueva de cultivo (novel-sect-cave-pass): horas que el miembro puede pasar adentro
 * sin el rango. Se gastan meditando ahí; sin horas, no queda pase.
 */
export interface SectCavePass {
  readonly org: EntityRef;
  readonly hours: number;
  readonly since: Tick;
}
export const SECT_CAVE_PASS = table<SectCavePass>("cultivation.sect_cave_pass");
/** Se le acabaron las horas del pase. */
export const SECT_CAVE_PASS_SPENT_EVENT = "cultivation.sect_cave_pass_spent";

/** El ascenso de externo a interno (novel-sect-duty-rank, organizations §6). */
export const SECT_PROMOTED_EVENT = "cultivation.sect_promoted";
/** Las horas de tarea anotadas que pide la secta para subir a interno (sin calibrar). */
export const PROMOTION_CHORE_HOURS = 240;
/** Los umbrales del qi cruzados que pide la secta para subir a interno. */
export const PROMOTION_STAGE = 1;

/**
 * Si el miembro externo ya subiría a interno: aportó las horas de tarea en esa secta y cruzó el
 * tramo de cultivo pedido. Las horas no se gastan al canjear (los puntos sí).
 */
export function promotionDue(
  member: SectMember | undefined,
  contribution: SectContribution | undefined,
  stage: number,
): boolean {
  return (
    member?.rank === "outer" &&
    contribution?.org === member.org &&
    contribution.hours >= PROMOTION_CHORE_HOURS &&
    stage >= PROMOTION_STAGE
  );
}

/** El canje de aportes por horas de pase (novel-sect-duty-exchange). */
export const SECT_EXCHANGE_EVENT = "cultivation.sect_exchange";
/** Cuántos puntos de contribución cuesta una hora de cueva (sin calibrar). */
export const CAVE_PASS_POINTS_PER_HOUR = 2;
/** Las horas que se piden si no se dice cuántas. */
export const REDEEM_DEFAULT_HOURS = 4;
/** Por qué la secta no canjea. */
export type ExchangeRefusal = "not_member" | "no_need" | "no_points";

/**
 * Cuántas horas enteras de pase da la secta si se piden `wanted` (o las de siempre) y hay `points`:
 * lo pedido o lo que alcance, lo menor; y los puntos que se descuentan.
 */
export function exchangeHours(
  points: number,
  wanted: number | null,
): { readonly hours: number; readonly cost: number } {
  const want = Math.max(1, Math.floor(wanted ?? REDEEM_DEFAULT_HOURS));
  const hours = Math.max(0, Math.min(want, Math.floor(points / CAVE_PASS_POINTS_PER_HOUR)));
  return { hours, cost: hours * CAVE_PASS_POINTS_PER_HOUR };
}

/**
 * El permiso para bajar de la sede (novel-sect-seat-return-leave): hasta cuándo puede estar afuera.
 * Lo da la secta al que lo pide estando en su sede (`furlough`); vence solo.
 */
export interface SectLeave {
  readonly org: EntityRef;
  readonly from: Tick;
  readonly until: Tick;
}
export const SECT_LEAVE = table<SectLeave>("cultivation.sect_leave");
/** El pedido de permiso, dado o negado. */
export const SECT_LEAVE_EVENT = "cultivation.sect_leave";
/** Los días de permiso si no dice cuántos, y el máximo que da la secta (sin calibrar). */
export const LEAVE_DEFAULT_DAYS = 7;
export const LEAVE_MAX_DAYS = 30;

/** Los días enteros de permiso que da la secta si se piden `wanted` (o los de siempre). */
export function leaveDays(wanted: number | null): number {
  return Math.min(LEAVE_MAX_DAYS, Math.max(1, Math.ceil(wanted ?? LEAVE_DEFAULT_DAYS)));
}

/**
 * Lo que la secta sabe de dónde está el miembro (novel-sect-seat-return-leave): desde cuándo está
 * en la sede o afuera, y, afuera, hasta cuándo tenía permiso y si ya se pasó. Nace la primera vez
 * que está en el parche de la sede: al que todavía no subió no se le cuenta ausencia.
 */
export interface SectPresence {
  readonly org: EntityRef;
  readonly away: boolean;
  readonly since: Tick;
  /** Afuera con permiso: hasta cuándo. */
  readonly until?: Tick;
  /** Afuera y pasado del plazo (o del día de gracia sin permiso): la secta ya lo anotó. */
  readonly overdue?: boolean;
}
export const SECT_PRESENCE = table<SectPresence>("cultivation.sect_presence");
export const SECT_LEFT_EVENT = "cultivation.sect_left";
export const SECT_OVERDUE_EVENT = "cultivation.sect_overdue";
export const SECT_RETURNED_EVENT = "cultivation.sect_returned";
/** Sin permiso, cuánto puede faltar antes de que cuente (una bajada a buscar algo). */
export const ABSENCE_GRACE_DAYS = 1;
/** Los puntos de aporte que se pierden por día pasado del plazo (sin calibrar). */
export const ABSENCE_POINTS_PER_DAY = 2;

/** Cuándo vence la ausencia: el permiso, o el día de gracia desde que se fue. */
export function absenceDue(p: SectPresence, dayTicks: number): Tick {
  return (p.until ?? p.since + ABSENCE_GRACE_DAYS * dayTicks) as Tick;
}

/** Los días pasados del plazo al volver `now` (fraccionarios, 0 si volvió a tiempo). */
export function lateDays(p: SectPresence, now: Tick, dayTicks: number): number {
  return Math.max(0, (now - absenceDue(p, dayTicks)) / dayTicks);
}

/** Los puntos que pierde por volver `late` días tarde, hasta lo que tiene. */
export function absencePenalty(points: number, late: number): number {
  return late <= 0 ? 0 : Math.min(Math.max(0, points), Math.ceil(late) * ABSENCE_POINTS_PER_DAY);
}

/** Los rangos que entran a la cueva sin pase. */
export const CAVE_RANKS: ReadonlySet<MemberRank> = new Set(["inner", "core", "elder", "master"]);

/**
 * Si la secta no deja a `who` entrar a `space`: es la cueva de su sede y no tiene rango interno o
 * más ni un pase con horas de esa secta (el que no es de la secta, tampoco entra).
 */
export function caveBarred(
  truth: ReadonlyWorldTruth,
  who: EntityRef,
  space: string | undefined,
): boolean {
  if (!isSectCave(space)) return false;
  const org = (truth.ids(SECT) as EntityRef[]).find((id) => {
    const seat = truth.get(SECT, id)?.seatPlace;
    return seat !== undefined && space?.startsWith(`sect:${seat}/`);
  });
  if (org === undefined) return false;
  const member = truth.get(SECT_MEMBER, who);
  if (member?.org === org && CAVE_RANKS.has(member.rank)) return false;
  const pass = truth.get(SECT_CAVE_PASS, who);
  return !(pass?.org === org && pass.hours > 0);
}

/** El sueldo del mes desde el tesoro de la secta (novel-sect-duty-stipend). */
export const SECT_STIPEND_EVENT = "cultivation.sect_stipend";
/** Cada cuántos días se paga el sueldo. */
export const STIPEND_EVERY_DAYS = 30;
/** El sueldo de cada rango en cobre por mes (sin calibrar). */
export const STIPEND_BY_RANK: Readonly<Record<MemberRank, number>> = {
  outer: 30,
  inner: 60,
  core: 100,
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
