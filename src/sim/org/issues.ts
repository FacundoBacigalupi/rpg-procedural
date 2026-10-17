// Consejo de aldea 3 (organizations §4): asuntos y deliberación. Un asunto nace de una presión real
// que un miembro del órgano PERCIBE (con más o menos claridad según lo cerca que le toca) y le
// conviene plantear; el órgano delibera: los demás oyen la creencia del que planteó (con la fe que
// le tienen) y votan por utilidad mixta (lo que creen que le conviene a la organización y lo que le
// conviene a cada uno), con softmax sobre el RNG del proceso. El resultado es una `OrgDecision`.
// Sin tesoro ni órdenes (eso es «Consejo de aldea 4»): la decisión queda dicha, no ejecutada.
//
// Puro: ningún decisor lee la verdad, solo `IssueBelief` y lo que cada miembro siente (relaciones).

import {
  type AgentId,
  type CauseRef,
  type EventId,
  exp,
  type OrgId,
  type Rng,
  type Tick,
} from "../../core/index.ts";
import { table } from "../world/index.ts";
import { activeMembers, type Organization, type OrgRank } from "./council.ts";

export type IssueKind = "famine" | "debt" | "dispute";
export type IssueOption = "relief" | "extend" | "mediate";
export type Vote = "for" | "against";
export type DecisionOutcome = "enacted" | "rejected" | "lapsed";

/** La opción que el consejo discute para cada tipo de asunto (la alternativa es siempre no hacer nada). */
export const OPTION_OF: Readonly<Record<IssueKind, IssueOption>> = {
  famine: "relief",
  debt: "extend",
  dispute: "mediate",
};

/** Lo que alguien cree de una presión: cuán grave y con cuánta fe. Puede estar equivocado. */
export interface IssueBelief {
  readonly kind: IssueKind;
  readonly subject: string;
  /** 0-1: gravedad creída. */
  readonly severity: number;
  /** 0-1: cuánta fe le tiene a lo que cree. */
  readonly confidence: number;
}

export interface Issue {
  readonly id: string;
  readonly org: OrgId;
  readonly kind: IssueKind;
  readonly subject: string;
  readonly raisedBy: AgentId;
  readonly raisedAt: Tick;
  /** Lo que el que lo planteó cree (en el momento de plantearlo). */
  readonly beliefs: readonly IssueBelief[];
  /** El evento `org.issue_raised` que lo abrió. */
  readonly raisedEvent: EventId;
  readonly causes: readonly CauseRef[];
}

export interface CastVote {
  readonly agent: AgentId;
  readonly vote: Vote;
  readonly weight: number;
  readonly utility: number;
  /** Cuánto creía el asunto quien votó (0 si no se enteró de nada). */
  readonly confidence: number;
}

export interface OrgDecision {
  readonly id: string;
  readonly org: OrgId;
  readonly issue: string;
  readonly kind: IssueKind;
  readonly subject: string;
  readonly option: IssueOption;
  readonly raisedBy: AgentId;
  readonly outcome: DecisionOutcome;
  readonly votes: readonly CastVote[];
  readonly decidedAt: Tick;
  readonly raisedEvent: EventId;
  /** Los eventos de los que cuelga (el asunto planteado y, si lo hubo, el estado que lo causó). */
  readonly causes: readonly CauseRef[];
}

/** Los asuntos abiertos y lo ya decidido de una organización. Solo la escribe `life.council`. */
export interface Agenda {
  readonly open: readonly Issue[];
  readonly decisions: readonly OrgDecision[];
  /** Contador de ids de asuntos y decisiones. */
  readonly serial: number;
}

export const ORG_AGENDA = table<Agenda>("org.agenda");
export const EMPTY_AGENDA: Agenda = { open: [], decisions: [], serial: 0 };

export interface IssueRules {
  /** Con menos claridad que esto, el miembro ni se entera. */
  readonly perceiveFloor: number;
  /** Urgencia creída mínima (gravedad × fe) para plantearlo. */
  readonly raiseFloor: number;
  /** Utilidad mínima de la opción para quien la plantea (si le conviene callar, calla). */
  readonly raiseMinUtility: number;
  /** Cuánto pesa la organización en la utilidad de cada uno (el resto es lo personal). */
  readonly wOrg: number;
  /** Escala del softmax del voto: menor = más decidido por la utilidad. */
  readonly temperature: number;
  /** Días de deliberación entre plantear y votar. */
  readonly deliberationDays: number;
  /** Días antes de volver a plantear el mismo asunto tras decidirlo. */
  readonly cooldownDays: number;
  /** Asuntos abiertos como máximo por organización. */
  readonly maxOpen: number;
  /** Decisiones que se guardan. */
  readonly keepDecisions: number;
}

export const DEFAULT_ISSUE_RULES: IssueRules = {
  perceiveFloor: 0.2,
  raiseFloor: 0.25,
  raiseMinUtility: -0.1,
  wOrg: 0.6,
  temperature: 0.25,
  deliberationDays: 1,
  cooldownDays: 30,
  maxOpen: 3,
  keepDecisions: 20,
};

/** Lo que un miembro sabe de sí frente a una presión: lo que le toca y lo que sabe de los afectados. */
export interface MemberView {
  readonly agent: AgentId;
  /** Lo toca directamente (él o su hogar son parte). */
  readonly affected: boolean;
  /** 0-1: lo cerca que está de los afectados (cariño, trato). */
  readonly closeness: number;
  /** -1..1: cuánto le conviene a él que se actúe (su interés propio, no el de la organización). */
  readonly stake: number;
  /** -1..1: la confianza que le tiene a quien lo plantea (por vínculo, no por el asunto). */
  readonly trustIn: (who: AgentId) => number;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const round6 = (x: number): number => Math.round(x * 1e6) / 1e6;

/**
 * Lo que `view.agent` percibe de una presión de gravedad real `severity`: nada si le queda lejos; si
 * no, la gravedad vista con la claridad que da lo cerca que está (los afectados la ven entera).
 */
export function perceiveIssue(
  kind: IssueKind,
  subject: string,
  severity: number,
  view: MemberView,
  rules: IssueRules = DEFAULT_ISSUE_RULES,
): IssueBelief | null {
  const clarity = view.affected ? 1 : clamp(view.closeness, 0, 1);
  if (clarity < rules.perceiveFloor) return null;
  return {
    kind,
    subject,
    severity: round6(clamp(severity * (0.5 + 0.5 * clarity), 0, 1)),
    confidence: round6(clarity),
  };
}

/** Lo que oye `listener` de la creencia de otro: la fe en ella es la del que habla, ajustada por confianza. */
export function hearIssue(b: IssueBelief, trust: number): IssueBelief {
  return {
    ...b,
    confidence: round6(clamp(b.confidence * (0.5 + 0.5 * clamp(trust, -1, 1)), 0, 1)),
  };
}

export const urgency = (b: IssueBelief): number => round6(b.severity * b.confidence);

export interface Weights {
  readonly org: number;
  readonly self: number;
}

/** Pesos de la utilidad mixta: el cabeza carga más con la organización. */
export function weightsFor(rank: OrgRank, rules: IssueRules): Weights {
  const org = clamp(rules.wOrg + (rank === "head" ? 0.1 : 0), 0, 1);
  return { org: round6(org), self: round6(1 - org) };
}

/**
 * U(actuar) − U(no hacer nada) para quien cree `b` (o nada, si no se enteró): lo que cree que le
 * conviene a la organización (gravedad × fe) y lo que le conviene a él (`stake`), más el sesgo de
 * confiar o no en quien lo planteó.
 */
export function utility(
  b: IssueBelief | null,
  view: MemberView,
  raisedBy: AgentId,
  w: Weights,
): number {
  const orgU = b ? urgency(b) : 0;
  const bias = view.agent === raisedBy ? 0 : 0.2 * clamp(view.trustIn(raisedBy), -1, 1);
  return round6(w.org * orgU + w.self * clamp(view.stake, -1, 1) + bias);
}

export interface Perceived {
  readonly view: MemberView;
  readonly belief: IssueBelief | null;
}

/**
 * Quién planteará el asunto: entre los miembros que lo perciben con urgencia suficiente y a los
 * que les conviene actuar (o al menos no les perjudica mucho), el más urgido (desempate por id).
 * Nadie → el asunto no existe para la organización aunque la presión sea real.
 */
export function chooseRaiser(
  org: Organization,
  perceived: ReadonlyMap<AgentId, Perceived>,
  rules: IssueRules = DEFAULT_ISSUE_RULES,
): { agent: AgentId; belief: IssueBelief } | null {
  let best: { agent: AgentId; belief: IssueBelief; u: number } | null = null;
  for (const m of activeMembers(org)) {
    const p = perceived.get(m.agent);
    if (!p?.belief) continue;
    const u = urgency(p.belief);
    if (u < rules.raiseFloor) continue;
    const util = utility(p.belief, p.view, m.agent, weightsFor(m.rank, rules));
    if (util < rules.raiseMinUtility) continue;
    if (best === null || u > best.u || (u === best.u && m.agent < best.agent))
      best = { agent: m.agent, belief: p.belief, u };
  }
  return best ? { agent: best.agent, belief: best.belief } : null;
}

/** Probabilidad de votar a favor con utilidad `u` (logística de escala `temperature`). */
export const voteProbability = (u: number, temperature: number): number =>
  round6(1 / (1 + exp(-u / Math.max(1e-6, temperature))));

export interface DeliberateInput {
  readonly org: Organization;
  readonly issue: Issue;
  /** Lo que cada miembro percibe por sí hoy (sin lo que oye del que planteó). */
  readonly perceived: ReadonlyMap<AgentId, Perceived>;
  readonly raiserBelief: IssueBelief;
  readonly rules?: IssueRules;
  readonly rng: Rng;
  readonly at: Tick;
  readonly decisionId: string;
}

export interface Deliberation {
  readonly decision: OrgDecision;
  /** Los que no sabían y se enteraron por el que lo planteó. */
  readonly circulated: readonly AgentId[];
}

/**
 * Delibera: cada miembro suma a lo que percibe lo que oye del que planteó (la creencia circula con
 * la fe que le tiene), calcula su utilidad y vota con softmax (`rng.fork("vote", agente)`). Regla
 * `consensus_of_elders`: gana la mayoría del peso de los asientos (cabeza 1.5, ancianos 1); el empate
 * rechaza. Los votos se emiten en orden de id.
 */
export function deliberate(i: DeliberateInput): Deliberation {
  const rules = i.rules ?? DEFAULT_ISSUE_RULES;
  const organ = i.org.organs[0];
  const seatWeight = (rank: OrgRank): number =>
    organ?.seats.find((s) => s.rank === rank)?.weight ?? 1;
  const members = [...activeMembers(i.org)].sort((a, b) => (a.agent < b.agent ? -1 : 1));
  const votes: CastVote[] = [];
  const circulated: AgentId[] = [];
  let forW = 0;
  let againstW = 0;
  for (const m of members) {
    const p = i.perceived.get(m.agent);
    if (!p) continue;
    let belief = p.belief;
    if (m.agent !== i.issue.raisedBy) {
      const heard = hearIssue(i.raiserBelief, p.view.trustIn(i.issue.raisedBy));
      if (belief === null || heard.confidence > belief.confidence) {
        if (belief === null) circulated.push(m.agent);
        belief =
          belief === null
            ? heard
            : { ...heard, severity: Math.max(heard.severity, belief.severity) };
      }
    }
    const w = seatWeight(m.rank);
    const u = utility(belief, p.view, i.issue.raisedBy, weightsFor(m.rank, rules));
    const vote: Vote = i.rng.fork("vote", m.agent).chance(voteProbability(u, rules.temperature))
      ? "for"
      : "against";
    if (vote === "for") forW += w;
    else againstW += w;
    votes.push({
      agent: m.agent,
      vote,
      weight: w,
      utility: u,
      confidence: belief?.confidence ?? 0,
    });
  }
  return {
    decision: {
      id: i.decisionId,
      org: i.org.id,
      issue: i.issue.id,
      kind: i.issue.kind,
      subject: i.issue.subject,
      option: OPTION_OF[i.issue.kind],
      raisedBy: i.issue.raisedBy,
      outcome: forW > againstW ? "enacted" : "rejected",
      votes,
      decidedAt: i.at,
      raisedEvent: i.issue.raisedEvent,
      causes: [{ kind: "event", event: i.issue.raisedEvent }, ...i.issue.causes],
    },
    circulated,
  };
}

/** Un asunto cerrado sin votar porque la presión ya no está. */
export function lapse(issue: Issue, at: Tick, decisionId: string): OrgDecision {
  return {
    id: decisionId,
    org: issue.org,
    issue: issue.id,
    kind: issue.kind,
    subject: issue.subject,
    option: OPTION_OF[issue.kind],
    raisedBy: issue.raisedBy,
    outcome: "lapsed",
    votes: [],
    decidedAt: at,
    raisedEvent: issue.raisedEvent,
    causes: [{ kind: "event", event: issue.raisedEvent }],
  };
}

/** Pone el asunto en la agenda (abierto), con el contador avanzado. */
export function openIssue(a: Agenda, issue: Issue): Agenda {
  return { ...a, open: [...a.open, issue], serial: a.serial + 1 };
}

/** Cierra el asunto con su decisión, guardando las últimas `keep`. */
export function closeIssue(a: Agenda, decision: OrgDecision, keep: number): Agenda {
  return {
    open: a.open.filter((x) => x.id !== decision.issue),
    decisions: [...a.decisions, decision].slice(-Math.max(1, keep)),
    serial: a.serial + 1,
  };
}

/** ¿Ya hay un asunto abierto o decidido hace poco sobre lo mismo? */
export function recentlyHandled(
  a: Agenda,
  kind: IssueKind,
  subject: string,
  now: Tick,
  cooldown: number,
): boolean {
  if (a.open.some((x) => x.kind === kind && x.subject === subject)) return true;
  return a.decisions.some(
    (d) => d.kind === kind && d.subject === subject && now - d.decidedAt < cooldown,
  );
}

/** Lo que tiene que cumplir toda agenda; devuelve las violaciones. */
export function agendaViolations(org: Organization, a: Agenda): readonly string[] {
  const out: string[] = [];
  const everMember = new Set(org.members.map((m) => m.agent as string));
  const ids = new Set<string>();
  for (const x of a.open) {
    if (ids.has(x.id)) out.push(`${org.id}: asunto ${x.id} repetido`);
    ids.add(x.id);
    if (x.org !== org.id) out.push(`${org.id}: el asunto ${x.id} es de otra organización`);
    if (!everMember.has(x.raisedBy))
      out.push(`${org.id}: ${x.id} lo planteó ${x.raisedBy}, que no es miembro`);
    if (!x.raisedEvent) out.push(`${org.id}: asunto ${x.id} sin evento`);
    if (x.causes.length === 0) out.push(`${org.id}: asunto ${x.id} sin causas`);
    if (x.beliefs.length === 0) out.push(`${org.id}: asunto ${x.id} sin creencias`);
  }
  for (const d of a.decisions) {
    if (ids.has(d.id)) out.push(`${org.id}: decisión ${d.id} repetida`);
    ids.add(d.id);
    if (a.open.some((x) => x.id === d.issue)) out.push(`${org.id}: ${d.issue} decidido y abierto`);
    if (d.causes.length === 0) out.push(`${org.id}: decisión ${d.id} sin causas`);
    if (!everMember.has(d.raisedBy)) out.push(`${org.id}: ${d.id} planteada por un no miembro`);
    const seen = new Set<string>();
    let f = 0;
    let c = 0;
    for (const v of d.votes) {
      if (seen.has(v.agent)) out.push(`${org.id}: ${v.agent} votó dos veces en ${d.id}`);
      seen.add(v.agent);
      if (!everMember.has(v.agent))
        out.push(`${org.id}: ${v.agent} votó en ${d.id} sin ser miembro`);
      if (v.vote === "for") f += v.weight;
      else c += v.weight;
    }
    if (d.outcome === "lapsed") {
      if (d.votes.length > 0) out.push(`${org.id}: ${d.id} caducó con votos`);
    } else if ((d.outcome === "enacted") !== f > c)
      out.push(`${org.id}: ${d.id} tiene un resultado que no coincide con los votos`);
  }
  return out;
}
