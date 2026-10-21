// Repartos con compromisos y free riders de un proyecto cooperativo (schemes §9, "El problema de
// la acción colectiva"). Aportar compite con la vida diaria; sin control aparecen los que dan menos
// de lo prometido, y si el reparto es injusto (o lo parece) los demás se van. Los compromisos
// (contracts) y la vigilancia del líder suben el costo de fallar. Todo puro; la aleatoriedad llega
// por el `Random` del llamador.

import type { EventId, Random } from "../../core/index.ts";
import type { Commitment, CommitmentObligation, ObligationState } from "../contracts/commitment.ts";
import { type Participation, type Project, shareWeights } from "./project.ts";

const round6 = (x: number): number => Math.round(x * 1e6) / 1e6;
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const logged = (p: Project, eventId: EventId): readonly EventId[] => [...p.log, eventId];

/** Lo que un participante decide aportar este turno, contra lo que prometió. */
export interface ContributorView {
  readonly cooperativeness: number;
  /** Cuánto le cuesta aportar frente a su vida diaria. */
  readonly opportunityCost: number;
  /** Fracción de los demás que cree que aportan como prometieron. */
  readonly believedOthersPay: number;
  /** Lo que cree que lo van a controlar. */
  readonly believedOversight: number;
}

/**
 * Fracción de lo prometido que realmente aporta (0-1). Quien cree que los demás no pagan, que nadie
 * controla y que le cuesta caro, da menos: free rider.
 */
export function contributionFraction(v: ContributorView, rng: Random): number {
  const drive =
    0.45 * v.cooperativeness +
    0.25 * v.believedOthersPay +
    0.2 * v.believedOversight -
    0.4 * v.opportunityCost +
    0.35;
  return round6(clamp01(drive + (rng.float() - 0.5) * 0.1));
}

/** Cuánto le falta a un participante de lo prometido (0 = cumplió, 1 = nada). */
export function shortfall(x: Participation): number {
  return x.promised === 0 ? 0 : round6(clamp01(1 - x.contributed / x.promised));
}

export const FREE_RIDER_TOLERANCE = 0.25;

/** Quiénes aportan bastante menos de lo prometido, a la vista de la verdad del proyecto. */
export function freeRiders(p: Project): readonly Participation[] {
  return p.participants.filter(
    (x) => !x.left && !x.forfeited && shortfall(x) > FREE_RIDER_TOLERANCE,
  );
}

/** Fracción de participantes que son free riders (lo que los demás perciben de a poco). */
export function freeRiderFraction(p: Project): number {
  const n = p.participants.filter((x) => !x.left).length;
  return n === 0 ? 0 : round6(freeRiders(p).length / n);
}

/**
 * El líder vigila: cada free rider es descubierto con probabilidad `vigilance` por su déficit.
 * Devuelve los descubiertos (en orden de participación, para que sea determinista).
 */
export function detectFreeRiders(
  p: Project,
  vigilance: number,
  rng: Random,
): readonly Participation[] {
  const out: Participation[] = [];
  for (const x of freeRiders(p)) {
    if (rng.float() < clamp01(vigilance) * shortfall(x)) out.push(x);
  }
  return out;
}

/** Sanción: el descubierto pierde su parte (lo ya aportado queda en el pool). */
export function sanctionFreeRider(
  p: Project,
  agent: Participation["agent"],
  eventId: EventId,
): Project {
  if (!p.participants.some((x) => x.agent === agent && !x.forfeited)) return p;
  return {
    ...p,
    participants: p.participants.map((x) => (x.agent === agent ? { ...x, forfeited: true } : x)),
    log: logged(p, eventId),
  };
}

// --- Compromiso de reparto ------------------------------------------------------------------

const obligationState = (promised: number, performed: number, overdue: boolean): ObligationState =>
  performed >= promised
    ? "fulfilled"
    : overdue
      ? "defaulted"
      : performed > 0
        ? "partial"
        : "pending";

/**
 * El acuerdo del proyecto como `Commitment` (contracts): cada participante debe su aporte al
 * proyecto; ejecutores sociales (la aldea) y, si hay líder que vigila, la organización. Lo
 * aportado hasta ahora figura como cumplido.
 */
export function shareCommitment(
  p: Project,
  i: {
    readonly id: string;
    readonly startDay: number;
    readonly dueDay: number;
    readonly day: number;
  },
): Commitment {
  const overdue = i.day > i.dueDay;
  const obligations: CommitmentObligation[] = p.participants.map((x) => ({
    id: `${i.id}:${x.agent}`,
    debtor: x.agent,
    creditor: p.id,
    duty: { kind: "deliver", unit: p.pool.good, qty: x.promised },
    dueDay: i.dueDay,
    state: obligationState(x.promised, x.contributed, overdue),
    performed: Math.min(x.contributed, x.promised),
  }));
  const status = obligations.every((o) => o.state === "fulfilled")
    ? "fulfilled"
    : obligations.some((o) => o.state === "defaulted")
      ? "defaulted"
      : "active";
  return {
    id: i.id,
    kind: "project-share",
    basis: "agreement",
    parties: [
      { ref: p.owner, role: "leader" },
      ...p.participants.map((x) => ({ ref: x.agent as string, role: x.role })),
    ],
    obligations,
    guarantees: [],
    enforcers: [
      { kind: "social", reads: "belief" },
      { kind: "counterparty", who: p.owner, reads: "belief" },
    ],
    status,
    term: { startDay: i.startDay, endDay: i.dueDay },
    originEventId: p.originEventId,
    history: p.log,
  };
}

// --- Irse, o traicionar -----------------------------------------------------------------------

/** Cómo ve el reparto un participante. */
export interface FairnessView {
  /** Lo que cree que va a recibir (0-1 del pool). */
  readonly believedShare: number;
  /** Fracción de free riders que percibe. */
  readonly perceivedFreeRiders: number;
  /** Confianza en el líder. */
  readonly trustInLeader: number;
  /** Lo que ya puso (hundido): lo ata. */
  readonly sunk: number;
}

/** Parte que de verdad le tocaría hoy a `agent` según la regla del proyecto (0-1). */
export function actualShare(p: Project, agent: Participation["agent"]): number {
  const ws = shareWeights(p);
  const total = ws.reduce((a, w) => a + w.weight, 0);
  const mine = ws.find((w) => w.agent === agent)?.weight ?? 0;
  return total === 0 ? 0 : round6(mine / total);
}

export const LEAVE_THRESHOLD = 0.3;

/**
 * Se va (o traiciona) quien ve el reparto injusto: recibe menos de lo que cree que le toca, hay
 * free riders impunes y no confía en el líder; lo ya puesto lo retiene.
 */
export function leavePressure(v: FairnessView, actual: number): number {
  const unfair = clamp01((v.believedShare - actual) / Math.max(v.believedShare, 1e-6));
  return round6(
    0.5 * unfair + 0.3 * v.perceivedFreeRiders + 0.3 * (1 - v.trustInLeader) - 0.3 * v.sunk,
  );
}

export function wantsToLeave(v: FairnessView, actual: number): boolean {
  return leavePressure(v, actual) >= LEAVE_THRESHOLD;
}

/** El participante se va: lo aportado queda en el pool (conservación) y ya no cobra. */
export function leaveProject(p: Project, agent: Participation["agent"], eventId: EventId): Project {
  if (!p.participants.some((x) => x.agent === agent && !x.left)) return p;
  return {
    ...p,
    participants: p.participants.map((x) => (x.agent === agent ? { ...x, left: true } : x)),
    log: logged(p, eventId),
  };
}
