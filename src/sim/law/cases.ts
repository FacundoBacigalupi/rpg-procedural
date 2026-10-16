// El caso de una denuncia ante un foro (law §4, Consejo de ancianos como jurisdicción). Puro y sin
// IO: el libro de casos de un foro (`CaseBook`, una fila por organización que juzga), abrir un caso
// desde una denuncia ya pesada y resolverlo con lo que decide `forumResponse`. El caso guarda lo
// que el foro CREYÓ (`belief`), nunca la verdad; la verdad del hecho (`facts`) es solo para el
// inspector. Sin investigación, compensación ni vendetta todavía: el estado final del caso es la
// respuesta del foro (descartado, mediado, citado o sancionado).

import type { AgentId, EventId, Tick } from "../../core/index.ts";
import { table } from "../world/index.ts";
import type { DeedKind } from "./deeds.ts";
import { type ForumResponse, type ForumStanding, forumPenalty } from "./forum.ts";

export type CaseStatus = "investigating" | "decided" | "dropped" | "settled";

export interface Verdict {
  /** Cuánto de la pena base impone el foro (0 si no puede o no quiere). */
  readonly penalty: number;
  readonly decidedAt: Tick;
}

export interface Case {
  /** `<org>#<n>`: el libro es por foro, el contador también. */
  readonly id: string;
  /** El foro (la organización) que lo lleva. */
  readonly forum: string;
  readonly accuser: AgentId;
  readonly accused: AgentId;
  /** Qué se dice que hizo. */
  readonly claimed: DeedKind;
  /** Hechos de la verdad que el caso toca, si el hecho citado se conoce (solo inspector). */
  readonly facts: readonly EventId[];
  /** Quien recibió la denuncia en el foro. */
  readonly judge: AgentId;
  /** Cuánto creyó el foro (0-1) al recibirla. */
  readonly belief: number;
  readonly response: ForumResponse;
  readonly status: CaseStatus;
  readonly verdict?: Verdict;
  readonly openedAt: Tick;
  /** La denuncia (el evento de habla que la contó). */
  readonly originEventId: EventId;
}

export interface CaseBook {
  readonly cases: readonly Case[];
  readonly serial: number;
}

export const CASES = table<CaseBook>("law.cases");
export const EMPTY_CASE_BOOK: CaseBook = { cases: [], serial: 0 };
/** Casos que guarda cada foro (los más viejos se olvidan del libro; quedan en los eventos). */
export const KEPT_CASES = 32;
/** Días antes de que el mismo acusador vuelva a abrir el mismo caso contra el mismo acusado. */
export const CASE_COOLDOWN_DAYS = 30;

export interface Denunciation {
  readonly forum: string;
  readonly accuser: AgentId;
  readonly accused: AgentId;
  readonly claimed: DeedKind;
  readonly judge: AgentId;
  readonly belief: number;
  readonly facts: readonly EventId[];
  readonly at: Tick;
  readonly origin: EventId;
}

/** ¿Ya hay un caso reciente igual (mismo acusador, acusado y cargo)? */
export function isRepeat(book: CaseBook | undefined, d: Denunciation, cooldown: Tick): boolean {
  return (book?.cases ?? []).some(
    (c) =>
      c.accuser === d.accuser &&
      c.accused === d.accused &&
      c.claimed === d.claimed &&
      d.at - c.openedAt < cooldown,
  );
}

const STATUS_OF: Readonly<Record<ForumResponse, CaseStatus>> = {
  ignore: "dropped",
  mediate: "settled",
  summon: "investigating",
  sanction: "decided",
};

/**
 * Abre el caso con la respuesta del foro. `scale` es la pena base del hecho (`penaltyScale`); si es 0
 * (el foro leyó el hecho como disculpable) una sanción se archiva. La sanción impone
 * `forumPenalty(scale, standing)`.
 */
export function openCase(
  book: CaseBook | undefined,
  d: Denunciation,
  response: ForumResponse,
  scale: number,
  standing: ForumStanding,
): { readonly book: CaseBook; readonly case: Case } {
  const before = book ?? EMPTY_CASE_BOOK;
  const serial = before.serial + 1;
  const penalty = response === "sanction" ? forumPenalty(scale, standing) : 0;
  const status: CaseStatus =
    response === "sanction" && penalty <= 0 ? "dropped" : STATUS_OF[response];
  const c: Case = {
    id: `${d.forum}#${serial}`,
    forum: d.forum,
    accuser: d.accuser,
    accused: d.accused,
    claimed: d.claimed,
    facts: d.facts,
    judge: d.judge,
    belief: d.belief,
    response,
    status,
    ...(status === "decided" ? { verdict: { penalty, decidedAt: d.at } } : {}),
    openedAt: d.at,
    originEventId: d.origin,
  };
  return { book: { cases: [...before.cases, c].slice(-KEPT_CASES), serial }, case: c };
}

/** Cuánto mueve la resolución de un caso en el mundo (law §4: compensación, cara y rencor). */
export interface CaseEffectRules {
  /** Gramos de grano de la multa completa (pena 1); la compensación es `pena * fineGrams`. */
  readonly fineGrams: number;
  /** Rencor que gana el sancionado hacia quien lo acusó, por unidad de pena. */
  readonly resentmentGain: number;
  /** Respeto que pierde el sancionado ante el consejo (cara), por unidad de pena. */
  readonly faceDrop: number;
  /** Rencor que baja entre las dos partes cuando el consejo media. */
  readonly mediationDrop: number;
}

export const DEFAULT_CASE_EFFECTS: CaseEffectRules = {
  fineGrams: 20000,
  resentmentGain: 0.15,
  faceDrop: 0.1,
  mediationDrop: 0.1,
};

/** Compensación en gramos: la parte de la multa que impone la pena, sin pasar de lo que el pagador tiene. */
export function compensationDue(penalty: number, fineGrams: number, balance: number): number {
  const due = Math.floor(Math.max(0, Math.min(1, penalty)) * Math.max(0, fineGrams));
  return Math.max(0, Math.min(due, Math.floor(balance)));
}

/** Suma `delta` a una dimensión de relación, acotada a [lo, hi] y redondeada. */
export function nudgeDim(value: number, delta: number, lo: number, hi: number): number {
  return Math.round(Math.min(hi, Math.max(lo, value + delta)) * 1e6) / 1e6;
}
