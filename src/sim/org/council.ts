// Consejo de aldea como primera organización (organizations §1-§3, §11): la organización como
// entidad con fundadores, membresía, puestos y un órgano, todo con `originEventId`. Primer corte:
// solo se funda (de los ancianos reales) y se registran las salidas por muerte; todavía no decide,
// no tiene tesoro ni lealtad como relación (ver ROADMAP, «Consejo de aldea 2-5»).
//
// Puro: sin IO ni reloj. La tabla `ORG` la escribe un único proceso (`life.council`).

import type { AgentId, EventId, OrgId, SettlementId, Tick } from "../../core/index.ts";
import { table } from "../world/index.ts";

export type OrgTemplate = "village_council";
export type OrgStatus = "active" | "dormant" | "dissolved";
export type MembershipVia = "founding" | "coopted";
export type MembershipExit = "death";
export type CouncilRank = "head" | "elder";
export type SelectionRule = "seniority";
export type OrganRule = "consensus_of_elders";

export interface Membership {
  readonly agent: AgentId;
  readonly rank: CouncilRank;
  /** Ids de `Position` que ocupa. */
  readonly positions: readonly string[];
  readonly via: MembershipVia;
  readonly since: Tick;
  /** Cuándo dejó de ser miembro; ausente = sigue. */
  readonly until?: Tick;
  readonly exit?: MembershipExit;
  /** Evento que explica la salida (la muerte), si la hubo. */
  readonly exitEventId?: EventId;
  /** Quién ocupó el asiento que dejó esta salida (reposición); ausente = asiento aún vacante. */
  readonly replacedBy?: AgentId;
  readonly originEventId: EventId;
}

export interface Position {
  readonly id: string;
  readonly title: string;
  readonly selection: SelectionRule;
  readonly holder: AgentId | null;
  readonly since: Tick;
  /** Si está vacante: desde cuándo y qué evento (la muerte del titular) la dejó así. */
  readonly vacantSince?: Tick;
  readonly vacatedBy?: EventId;
  readonly originEventId: EventId;
}

export interface Organ {
  readonly id: string;
  readonly seats: ReadonlyArray<{ readonly rank: CouncilRank; readonly weight: number }>;
  readonly rule: OrganRule;
}

/** Subconjunto de `Organization` de organizations §1 que este corte necesita. */
export interface Organization {
  readonly id: OrgId;
  readonly template: OrgTemplate;
  readonly settlement: SettlementId;
  readonly originEventId: EventId;
  readonly founders: readonly AgentId[];
  readonly status: OrgStatus;
  readonly members: readonly Membership[];
  readonly positions: readonly Position[];
  readonly organs: readonly Organ[];
}

/** Cada organización vive en una entidad `org:n` con este componente. Solo la escribe `life.council`. */
export const ORG = table<Organization>("org.organization");

export const HEAD_POSITION = "head";

export interface ElderCandidate {
  readonly agent: AgentId;
  readonly ageYears: number;
  /** 0-1: el respeto creído que la aldea le tiene (opcional; sin dato pesa 0). */
  readonly respect?: number;
}

export interface CouncilRules {
  /** Cuántos asientos como máximo. */
  readonly seats: number;
  /** Edad mínima (años) para sentarse. */
  readonly minAge: number;
  /** Con menos ancianos que esto no se funda. */
  readonly minSeats: number;
}

export const DEFAULT_COUNCIL_RULES: CouncilRules = { seats: 5, minAge: 45, minSeats: 2 };

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const round6 = (x: number): number => Math.round(x * 1e6) / 1e6;

/** Cuánto pesa un candidato: antigüedad (0.6) y respeto (0.4). Sin azar. */
export function eldership(c: ElderCandidate): number {
  return round6(0.6 * clamp01(c.ageYears / 80) + 0.4 * clamp01(c.respect ?? 0));
}

/**
 * Quiénes se sientan: los de edad mínima, ordenados por `eldership` (desempate por id), hasta
 * `seats`. Devuelve [] si no llegan a `minSeats`. El primero es el cabeza.
 */
export function chooseElders(
  candidates: readonly ElderCandidate[],
  rules: CouncilRules = DEFAULT_COUNCIL_RULES,
): readonly ElderCandidate[] {
  const ranked = candidates
    .filter((c) => c.ageYears >= rules.minAge)
    .map((c) => ({ c, w: eldership(c) }))
    .sort((x, y) => y.w - x.w || (x.c.agent < y.c.agent ? -1 : x.c.agent > y.c.agent ? 1 : 0))
    .slice(0, Math.max(0, rules.seats))
    .map((x) => x.c);
  return ranked.length < rules.minSeats ? [] : ranked;
}

export interface FoundCouncilInput {
  readonly id: OrgId;
  readonly settlement: SettlementId;
  readonly elders: readonly ElderCandidate[];
  readonly originEventId: EventId;
  readonly at: Tick;
}

/** Funda el consejo con `elders` ya elegidos (el primero es el cabeza). */
export function foundCouncil(i: FoundCouncilInput): Organization {
  if (i.elders.length === 0) throw new RangeError("un consejo necesita fundadores");
  const head = i.elders[0] as ElderCandidate;
  const members: Membership[] = i.elders.map((e, k) => ({
    agent: e.agent,
    rank: k === 0 ? "head" : "elder",
    positions: k === 0 ? [HEAD_POSITION] : [],
    via: "founding",
    since: i.at,
    originEventId: i.originEventId,
  }));
  return {
    id: i.id,
    template: "village_council",
    settlement: i.settlement,
    originEventId: i.originEventId,
    founders: i.elders.map((e) => e.agent),
    status: "active",
    members,
    positions: [
      {
        id: HEAD_POSITION,
        title: "cabeza del consejo",
        selection: "seniority",
        holder: head.agent,
        since: i.at,
        originEventId: i.originEventId,
      },
    ],
    organs: [
      {
        id: "council",
        seats: [
          { rank: "head", weight: 1.5 },
          { rank: "elder", weight: 1 },
        ],
        rule: "consensus_of_elders",
      },
    ],
  };
}

export const activeMembers = (org: Organization): readonly Membership[] =>
  org.members.filter((m) => m.until === undefined);

export const isMember = (org: Organization, who: AgentId): boolean =>
  activeMembers(org).some((m) => m.agent === who);

export const holderOf = (org: Organization, position: string): AgentId | null =>
  org.positions.find((p) => p.id === position)?.holder ?? null;

/**
 * Un miembro sale (hoy solo por muerte, con el evento que la explica): se cierra su membresía y
 * los puestos que ocupaba quedan vacantes (la sucesión es otro ítem). Si no queda nadie, el
 * consejo se disuelve. Idempotente si ya había salido.
 */
export function withdrawMember(
  org: Organization,
  who: AgentId,
  exit: { readonly at: Tick; readonly kind: MembershipExit; readonly event: EventId },
): Organization {
  if (!isMember(org, who)) return org;
  const members = org.members.map((m) =>
    m.agent === who && m.until === undefined
      ? { ...m, until: exit.at, exit: exit.kind, exitEventId: exit.event }
      : m,
  );
  const positions = org.positions.map((p) =>
    p.holder === who ? { ...p, holder: null, vacantSince: exit.at, vacatedBy: exit.event } : p,
  );
  const left = members.some((m) => m.until === undefined);
  return { ...org, members, positions, status: left ? org.status : "dissolved" };
}

export interface SuccessionCandidate {
  readonly agent: AgentId;
  readonly ageYears: number;
  readonly respect?: number;
}

/**
 * Legitimidad de un miembro para ser cabeza (organizations §3 «sucesión»): antigüedad en el consejo
 * (0.35, tope 20 años), edad (0.35) y respeto creído (0.30). Sin azar.
 */
export function headClaim(
  m: Membership,
  c: SuccessionCandidate,
  now: Tick,
  yearTicks: number,
): number {
  const tenure = clamp01((now - m.since) / yearTicks / 20);
  return round6(0.35 * tenure + 0.35 * clamp01(c.ageYears / 80) + 0.3 * clamp01(c.respect ?? 0));
}

/** El miembro activo con más derecho al puesto de cabeza (desempate por id), o null. */
export function electHead(
  org: Organization,
  info: ReadonlyMap<AgentId, SuccessionCandidate>,
  now: Tick,
  yearTicks: number,
): AgentId | null {
  let best: { agent: AgentId; w: number } | null = null;
  for (const m of activeMembers(org)) {
    const c = info.get(m.agent) ?? { agent: m.agent, ageYears: 0 };
    const w = headClaim(m, c, now, yearTicks);
    if (best === null || w > best.w || (w === best.w && m.agent < best.agent))
      best = { agent: m.agent, w };
  }
  return best?.agent ?? null;
}

/** ¿Está vacante el puesto de cabeza (y queda alguien para ocuparlo)? */
export const headVacant = (org: Organization): boolean =>
  org.status === "active" &&
  org.positions.some((p) => p.id === HEAD_POSITION && p.holder === null) &&
  activeMembers(org).length > 0;

/** Un miembro asume el puesto de cabeza (el evento `event` lo explica). */
export function fillHead(org: Organization, who: AgentId, at: Tick, event: EventId): Organization {
  if (!isMember(org, who) || !headVacant(org)) return org;
  const members = org.members.map((m) =>
    m.until !== undefined
      ? m
      : m.agent === who
        ? { ...m, rank: "head" as const, positions: [HEAD_POSITION] }
        : { ...m, rank: "elder" as const, positions: [] },
  );
  const positions = org.positions.map((p) =>
    p.id === HEAD_POSITION
      ? {
          id: p.id,
          title: p.title,
          selection: p.selection,
          holder: who,
          since: at,
          originEventId: event,
        }
      : p,
  );
  return { ...org, members, positions };
}

/** Asientos que dejó la muerte y nadie ocupó todavía, acotados por el tope de asientos. */
export function openSeats(org: Organization, rules: CouncilRules): number {
  if (org.status !== "active") return 0;
  const unreplaced = org.members.filter((m) => m.until !== undefined && m.replacedBy === undefined);
  return Math.max(0, Math.min(unreplaced.length, rules.seats - activeMembers(org).length));
}

/** La salida (la muerte) del asiento vacante más viejo, si hay: su `exitEventId` es la causa. */
export function oldestVacancy(org: Organization): Membership | undefined {
  return org.members
    .filter((m) => m.until !== undefined && m.replacedBy === undefined)
    .sort((a, b) => (a.until ?? 0) - (b.until ?? 0) || (a.agent < b.agent ? -1 : 1))[0];
}

/** Un nuevo anciano ocupa el asiento vacante más viejo (cooptado por el consejo). */
export function admitMember(
  org: Organization,
  who: AgentId,
  at: Tick,
  event: EventId,
): Organization {
  const seat = oldestVacancy(org);
  if (!seat || isMember(org, who)) return org;
  const members: Membership[] = org.members.map((m) =>
    m === seat ? { ...m, replacedBy: who } : m,
  );
  members.push({
    agent: who,
    rank: "elder",
    positions: [],
    via: "coopted",
    since: at,
    originEventId: event,
  });
  return { ...org, members };
}

/** Lo que tiene que cumplir toda organización (organizations «Tests»); devuelve las violaciones. */
export function orgViolations(org: Organization): readonly string[] {
  const out: string[] = [];
  if (!org.originEventId) out.push(`${org.id}: sin originEventId`);
  if (org.founders.length === 0) out.push(`${org.id}: sin fundadores`);
  const seen = new Set<string>();
  for (const m of activeMembers(org)) {
    if (seen.has(m.agent)) out.push(`${org.id}: ${m.agent} es miembro dos veces`);
    seen.add(m.agent);
    if (!m.originEventId) out.push(`${org.id}: membresía de ${m.agent} sin originEventId`);
  }
  for (const p of org.positions) {
    if (p.holder !== null && !seen.has(p.holder))
      out.push(`${org.id}: el puesto ${p.id} lo ocupa ${p.holder}, que no es miembro`);
    if (!p.originEventId) out.push(`${org.id}: puesto ${p.id} sin originEventId`);
  }
  const head = org.positions.find((p) => p.id === HEAD_POSITION);
  for (const m of activeMembers(org))
    if ((m.rank === "head") !== (head?.holder === m.agent))
      out.push(`${org.id}: ${m.agent} tiene el rango ${m.rank} que no coincide con el puesto`);
  for (const p of org.positions)
    if (p.holder === null && p.vacantSince !== undefined && p.vacatedBy === undefined)
      out.push(`${org.id}: puesto ${p.id} vacante sin causa`);
  for (const m of org.members)
    if (m.replacedBy !== undefined && !org.members.some((x) => x.agent === m.replacedBy))
      out.push(`${org.id}: el reemplazo ${m.replacedBy} no es miembro`);
  for (const m of org.members)
    if (m.until !== undefined && m.exitEventId === undefined)
      out.push(`${org.id}: salida de ${m.agent} sin evento`);
  if (org.status === "active" && seen.size === 0) out.push(`${org.id}: activa sin miembros`);
  return out;
}
