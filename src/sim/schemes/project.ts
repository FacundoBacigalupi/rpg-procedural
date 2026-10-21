// Proyectos cooperativos (schemes §9, F5): canal de aldea, caravana, expedición. Un `Project`
// tiene un plan real (el del dueño) y cada participante, su `knownPlan` (lo que le contaron, que
// puede diferir). Sumarse es una decisión por utilidad sobre lo creído; aportar sale de lo que
// el participante tiene y entra al pool (pool.ts). Núcleo puro: sin IO ni reloj; la aleatoriedad
// llega por el `Random` del llamador. El narrador solo recibe `knownPlan` del personaje
// (`playerKnownPlan`), nunca el proyecto entero.

import type { AgentId, EventId, ProjectId, Random } from "../../core/index.ts";
import {
  addContribution,
  distributePool,
  makePool,
  type Pool,
  type ShareWeight,
  spendFromPool,
} from "./pool.ts";

const round6 = (x: number): number => Math.round(x * 1e6) / 1e6;
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

export type CoopKind = "venture" | "expedition" | "construction" | "defense" | "festival";

export type ProjectStatus =
  | "forming"
  | "preparing"
  | "active"
  | "adapting"
  | "succeeded"
  | "failed"
  | "abandoned"
  | "dissolved";

/** Paso del plan: una clave estable (`dig`, `haul`, `guard`) y cuánto del pool necesita. */
export interface ProjectStep {
  readonly key: string;
  readonly cost: number;
}

/** Cómo se reparte lo que sobra (según la norma o el compromiso). */
export type ShareRule = "equal" | "contribution" | "stake";

export interface Participation {
  readonly agent: AgentId;
  readonly role: string;
  /** Claves de pasos que este participante cree que son el plan, en orden; null = no sabe nada. */
  readonly knownPlan: readonly string[] | null;
  /** Fracción del reparto que cree que le toca (0-1). */
  readonly believedShare: number;
  readonly joinedBy: EventId;
  /** Cuánto prometió aportar. */
  readonly promised: number;
  readonly contributed: number;
  /** Lo que arriesga además del aporte (0-1). */
  readonly stake: number;
  /** Perdió su parte por sanción (free rider descubierto). */
  readonly forfeited: boolean;
  readonly left: boolean;
}

export interface Project {
  readonly id: ProjectId;
  readonly kind: CoopKind;
  readonly owner: AgentId;
  /** El plan real, como lo tiene el dueño. */
  readonly plan: readonly ProjectStep[];
  readonly participants: readonly Participation[];
  readonly pool: Pool;
  readonly shareRule: ShareRule;
  readonly status: ProjectStatus;
  readonly originEventId: EventId;
  readonly log: readonly EventId[];
}

export function makeProject(i: {
  readonly id: ProjectId;
  readonly kind: CoopKind;
  readonly owner: AgentId;
  readonly plan: readonly ProjectStep[];
  readonly good: string;
  readonly shareRule: ShareRule;
  readonly originEventId: EventId;
}): Project {
  return {
    id: i.id,
    kind: i.kind,
    owner: i.owner,
    plan: i.plan,
    participants: [],
    pool: makePool(i.good),
    shareRule: i.shareRule,
    status: "forming",
    originEventId: i.originEventId,
    log: [],
  };
}

/** Causas de un evento del proyecto: el último registrado y el origen. */
export function projectCauses(p: Project): readonly EventId[] {
  const last = p.log[p.log.length - 1];
  return last === undefined ? [p.originEventId] : [last, p.originEventId];
}

const logged = (p: Project, eventId: EventId): readonly EventId[] => [...p.log, eventId];

/** Lo que el invitado cree y es; todo 0-1. Nada de esto es la verdad del proyecto. */
export interface InviteeView {
  /** Lo que cree que va a recibir, ya en valor (0-1) respecto de lo que aporta. */
  readonly believedGain: number;
  /** Cuánto confía en el líder. */
  readonly trustInLeader: number;
  /** Riesgo que cree que corre. */
  readonly believedRisk: number;
  /** Peso de decir que no: cara, deuda, miedo, obediencia a la organización. */
  readonly costOfRefusing: number;
  /** Cuánto le cuesta su vida diaria dedicar tiempo al proyecto. */
  readonly opportunityCost: number;
  /** Rasgo: tendencia a cooperar (bajo = aprovechado). */
  readonly cooperativeness: number;
}

export const JOIN_THRESHOLD = 0.1;
export const JOIN_JITTER = 0.05;

export interface JoinDecision {
  readonly join: boolean;
  readonly net: number;
}

/** Sumarse es una decisión: lo creído por la confianza, menos riesgo y costo, más el costo de negarse. */
export function decideJoin(v: InviteeView, rng: Random): JoinDecision {
  const gain = v.believedGain * (0.4 + 0.6 * v.trustInLeader);
  const net = round6(
    gain +
      0.2 * v.cooperativeness +
      0.3 * v.costOfRefusing -
      0.5 * v.believedRisk -
      0.5 * v.opportunityCost +
      (rng.float() - 0.5) * 2 * JOIN_JITTER,
  );
  return { join: net >= JOIN_THRESHOLD, net };
}

/** Qué parte del plan le cuentan a un invitado (compartimentado, simplificado o entero). */
export function tellPlan(p: Project, take: number | "all"): readonly string[] {
  const keys = p.plan.map((s) => s.key);
  return take === "all" ? keys : keys.slice(0, Math.max(0, Math.floor(take)));
}

/** Suma a un invitado que decidió entrar. Un agente que ya está no se duplica. */
export function addParticipant(
  p: Project,
  i: {
    readonly agent: AgentId;
    readonly role: string;
    readonly knownPlan: readonly string[] | null;
    readonly believedShare: number;
    readonly promised: number;
    readonly stake: number;
    readonly joinedBy: EventId;
  },
): Project {
  if (p.participants.some((x) => x.agent === i.agent)) return p;
  const part: Participation = {
    agent: i.agent,
    role: i.role,
    knownPlan: i.knownPlan,
    believedShare: clamp01(i.believedShare),
    joinedBy: i.joinedBy,
    promised: Math.max(0, Math.floor(i.promised)),
    contributed: 0,
    stake: clamp01(i.stake),
    forfeited: false,
    left: false,
  };
  return {
    ...p,
    participants: [...p.participants, part],
    log: logged(p, i.joinedBy),
  };
}

const active = (p: Project): readonly Participation[] => p.participants.filter((x) => !x.left);

/**
 * Un participante aporta. `available` es lo que tiene de verdad (el llamador lo descuenta de su
 * inventario o de su día según `moved`). Nunca entra más de lo que tiene.
 */
export function contribute(
  p: Project,
  agent: AgentId,
  qty: number,
  available: number,
  eventId: EventId,
): { readonly project: Project; readonly moved: number } {
  const who = p.participants.find((x) => x.agent === agent && !x.left);
  if (who === undefined || p.status === "succeeded" || p.status === "failed") {
    return { project: p, moved: 0 };
  }
  const r = addContribution(p.pool, agent, qty, available, eventId);
  if (r.moved === 0) return { project: p, moved: 0 };
  return {
    moved: r.moved,
    project: {
      ...p,
      pool: r.pool,
      participants: p.participants.map((x) =>
        x.agent === agent ? { ...x, contributed: x.contributed + r.moved } : x,
      ),
      status: p.status === "forming" ? "preparing" : p.status,
      log: logged(p, eventId),
    },
  };
}

/** Gasta del pool en el próximo paso del plan que falta (el progreso es lo gastado en pasos). */
export function fundedSteps(p: Project): number {
  let left = p.pool.spent;
  let n = 0;
  for (const s of p.plan) {
    if (left < s.cost) break;
    left -= s.cost;
    n++;
  }
  return n;
}

/** Paga el costo del próximo paso con el pool; si no alcanza no gasta nada. */
export function advanceStep(
  p: Project,
  eventId: EventId,
): { readonly project: Project; readonly step: ProjectStep | null } {
  if (p.status === "succeeded" || p.status === "failed" || p.status === "dissolved") {
    return { project: p, step: null };
  }
  const n = fundedSteps(p);
  const step = p.plan[n];
  if (step === undefined || p.pool.balance < step.cost) return { project: p, step: null };
  const r = spendFromPool(p.pool, step.cost, step.key, eventId);
  const done = n + 1 >= p.plan.length;
  return {
    step,
    project: {
      ...p,
      pool: r.pool,
      status: done ? "succeeded" : "active",
      log: logged(p, eventId),
    },
  };
}

/** Cierra antes de tiempo; no pisa un éxito. */
export function endProject(
  p: Project,
  status: "failed" | "abandoned" | "dissolved",
  eventId: EventId,
): Project {
  return p.status === "succeeded" || p.status === status
    ? p
    : { ...p, status, log: logged(p, eventId) };
}

/** Pesos de reparto según la regla; sin los que se fueron ni los sancionados. */
export function shareWeights(p: Project): readonly ShareWeight[] {
  return active(p)
    .filter((x) => !x.forfeited)
    .map((x) => ({
      agent: x.agent,
      weight:
        p.shareRule === "equal"
          ? 1
          : p.shareRule === "contribution"
            ? x.contributed
            : round6(x.contributed * (1 + x.stake)),
    }));
}

/** Reparte lo que sobra según la regla; lo repartido sale del pool. */
export function settleProject(
  p: Project,
  eventId: EventId,
): { readonly project: Project; readonly payouts: readonly ShareWeight[] } {
  const r = distributePool(p.pool, shareWeights(p), eventId);
  return { payouts: r.payouts, project: { ...p, pool: r.pool, log: logged(p, eventId) } };
}

// --- Fallas de coordinación ---------------------------------------------------------------

/** Cuánto difiere lo que cree un participante del plan real (0 igual, 1 nada en común). */
export function planDivergence(p: Project, who: Participation): number {
  const real = p.plan.map((s) => s.key);
  const known = who.knownPlan ?? [];
  const len = Math.max(real.length, known.length);
  if (len === 0) return 0;
  let same = 0;
  for (let i = 0; i < len; i++) if (real[i] !== undefined && real[i] === known[i]) same++;
  return round6(1 - same / len);
}

export interface CoordinationFailure {
  readonly a: AgentId;
  readonly b: AgentId;
  /** Primer paso (índice) en que creen cosas distintas. */
  readonly atStep: number;
}

/** Pares de participantes que creen planes distintos: hacen cosas que no encajan. */
export function coordinationFailures(p: Project): readonly CoordinationFailure[] {
  const list = active(p).filter((x) => x.knownPlan !== null);
  const out: CoordinationFailure[] = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      if (a?.knownPlan == null || b?.knownPlan == null) continue;
      const len = Math.max(a.knownPlan.length, b.knownPlan.length);
      for (let k = 0; k < len; k++) {
        if (a.knownPlan[k] !== b.knownPlan[k]) {
          out.push({ a: a.agent, b: b.agent, atStep: k });
          break;
        }
      }
    }
  }
  return out;
}

/** Lo único que el narrador recibe del proyecto: el plan que conoce el personaje. */
export function playerKnownPlan(p: Project, player: AgentId): readonly string[] | null {
  return p.participants.find((x) => x.agent === player)?.knownPlan ?? null;
}
