// La investigación simple del consejo (law §5, §4): un caso `investigating` reúne indicios de lo
// que los miembros del foro CREEN y VEN (hechos que guardan, con quién fue según ellos, y huellas
// del lugar atadas a un hecho que ya saben de quién es), nunca de la verdad. Puro y sin IO: quien
// llama arma los `Clue` desde las creencias; acá se pesan, se corrige la creencia del foro sobre
// la denuncia y se decide con la misma regla del foro (`forumResponse`). Cada indicio vale lo que su
// vía (vi / oí / me contaron) y la culpa que leyó el que lo guarda; con testigos que declaran
// (`spokenWeight`), además la firmeza con que lo dicen, y quien niega o calla no deja indicio.

import type { AgentId, EventId, Tick } from "../../core/index.ts";
import type { Case, Investigation, Verdict } from "./cases.ts";
import { culpability, type Deed } from "./deeds.ts";
import { type ForumStanding, forumPenalty, forumResponse } from "./forum.ts";

export type ClueKind = "testimony" | "trace";

export interface Clue {
  readonly kind: ClueKind;
  /** Quién lo aporta (un miembro del foro o el acusador). */
  readonly source: AgentId;
  /** A quién señala según quien lo aporta (null: sabe que pasó, no quién). */
  readonly points: AgentId | null;
  /** Peso 0-1: cuánto vale como indicio. */
  readonly weight: number;
  /** El hecho de la verdad al que remite (inspector y causas; los decisores no lo leen). */
  readonly event: EventId;
}

/** Cuánto vale cada vía como testimonio. */
export const VIA_WEIGHT: Readonly<Record<Deed["via"], number>> = {
  saw: 1,
  heard: 0.7,
  told: 0.4,
};
/** El acusador es parte: su dicho pesa la mitad. */
export const PARTY_DISCOUNT = 0.5;
/** Una huella corrobora más débil que un testigo. */
export const TRACE_DISCOUNT = 0.5;
/** Cuánto mueve la creencia lo que señala al acusado (hacia 1) y lo que señala a otro (hacia 0). */
export const FOR_GAIN = 0.35;
export const AGAINST_GAIN = 0.45;
/** Días que espera un caso sin citación antes de investigarse. */
export const INVESTIGATION_DAYS = 2;

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const round = (x: number): number => Math.round(x * 1e6) / 1e6;

/** El peso de un hecho guardado como testimonio: la vía y la culpa que leyó quien lo guarda (tope 1). */
export function testimonyWeight(deed: Deed, party: boolean): number {
  const w = VIA_WEIGHT[deed.via] * Math.min(1, culpability(deed));
  return round(clamp01(party ? w * PARTY_DISCOUNT : w));
}

/** Cuánto del peso de un testimonio depende de la firmeza con que se dice (0 firmeza = esto de piso). */
export const CERTAINTY_FLOOR = 0.4;

/**
 * El peso de lo que un testigo DICE (no de lo que guarda): el peso de su vía por la firmeza con
 * que lo cuenta. Una mentira pulida suena firme y pesa más que un recuerdo borroso dicho con
 * duda; quien calla o niega no aporta indicio (`null`).
 */
export function spokenWeight(base: number, certainty: number, said: boolean): number | null {
  if (!said) return null;
  return round(clamp01(base * (CERTAINTY_FLOOR + (1 - CERTAINTY_FLOOR) * clamp01(certainty))));
}

/** El peso de una huella visible (fuerza 0-1) atada a un hecho que quien la ve ya sabe de quién es. */
export function traceWeight(strength: number): number {
  return round(clamp01((0.4 + clamp01(strength) / 2) * TRACE_DISCOUNT));
}

export interface ClueBalance {
  readonly clues: number;
  /** Peso combinado de lo que señala al acusado, 0-1 (1 - prod(1 - w)). */
  readonly for: number;
  /** Peso combinado de lo que señala a otro, 0-1. */
  readonly against: number;
}

const combined = (ws: readonly number[]): number =>
  1 - ws.reduce((p, w) => p * (1 - clamp01(w)), 1);

/** Suma los indicios: los que señalan al acusado y los que señalan a otro (los anónimos no pesan). */
export function balanceClues(clues: readonly Clue[], accused: AgentId): ClueBalance {
  const pro = clues.filter((c) => c.points === accused).map((c) => c.weight);
  const con = clues.filter((c) => c.points !== null && c.points !== accused).map((c) => c.weight);
  return {
    clues: pro.length + con.length,
    for: round(combined(pro)),
    against: round(combined(con)),
  };
}

/** La creencia del foro después de los indicios: sube con lo que señala al acusado, baja con lo que señala a otro. */
export function updateBelief(prior: number, b: ClueBalance): number {
  const p = clamp01(prior);
  const up = p + (1 - p) * FOR_GAIN * b.for;
  return round(clamp01(up - up * AGAINST_GAIN * b.against));
}

/**
 * Cierra el caso con lo investigado: la regla del foro sobre la creencia nueva. Un foro que solo
 * alcanzaba a citar no puede sancionar: media. La pena sale de `scale` y de lo que el foro pesa
 * sobre el acusado; sin pena (hecho disculpable) se archiva.
 */
export function resolveInvestigation(
  c: Case,
  b: ClueBalance,
  standing: ForumStanding,
  scale: number,
  at: Tick,
): Case {
  const after = updateBelief(c.belief, b);
  const response = forumResponse(after, false, standing);
  const penalty = response === "sanction" ? forumPenalty(scale, standing) : 0;
  const status: Case["status"] =
    response === "ignore" || (response === "sanction" && penalty <= 0)
      ? "dropped"
      : response === "sanction"
        ? "decided"
        : "settled";
  const verdict: Verdict | undefined =
    status === "decided" ? { penalty, decidedAt: at } : undefined;
  const investigation: Investigation = {
    at,
    clues: b.clues,
    for: b.for,
    against: b.against,
    beliefBefore: c.belief,
    beliefAfter: after,
  };
  return { ...c, status, investigation, ...(verdict ? { verdict } : {}) };
}

/** ¿El caso espera investigación? Citado que compareció, o sin citación y pasado el plazo desde la apertura. */
export function investigationDue(c: Case, now: Tick, waitFor: Tick): boolean {
  if (c.status !== "investigating" || c.investigation !== undefined) return false;
  if (c.summons) return c.summons.outcome === "appeared";
  return c.openedAt + waitFor <= now;
}
