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
