// Consejo de aldea 3 (organizations §4), lado de la vida: de qué presiones reales de la aldea salen
// asuntos (hambruna en un hogar, deuda caída en mora, disputa de dos vecinos con rencor) y cómo
// las ve cada miembro del consejo (`MemberView`). La verdad se lee acá, en el proceso; la
// deliberación (`sim/org/issues.ts`) solo recibe creencias y lo que cada uno siente.

import type { AgentId, CauseRef, Duration, EntityRef, Tick } from "../../core/index.ts";
import {
  type GoodDef,
  type IssueBelief,
  type IssueKind,
  type IssueRules,
  type MemberView,
  outstanding,
  PERSON,
  type Perceived,
  perceiveIssue,
  RELATIONS,
  type ReadonlyLedger,
  type ReadonlyWorldTruth,
  totalDue,
} from "../../sim/index.ts";
import { householdFlowsOf } from "./budget.ts";
import { LOANS } from "./loans.ts";

export interface IssuesOptions {
  /** Reglas de los asuntos; por defecto `DEFAULT_ISSUE_RULES`. */
  readonly rules?: Partial<IssueRules>;
  /** Días de despensa por debajo de los cuales un hogar pasa hambre (7 por defecto). */
  readonly famineDays?: number;
  /** Rencor (0-1) desde el que una disputa entre vecinos es asunto del consejo (0.5 por defecto). */
  readonly resentmentFloor?: number;
}

/** Una presión real de la aldea que podría llegar al consejo si alguien la percibe y la plantea. */
export interface PressureSignal {
  readonly kind: IssueKind;
  readonly subject: string;
  /** 0-1: gravedad real. */
  readonly severity: number;
  /** Las personas a las que toca directamente. */
  readonly affected: readonly AgentId[];
  /** Los hogares a los que toca (sus miembros también cuentan como afectados). */
  readonly affectedHomes: readonly string[];
  /** Por qué existe: estados y eventos reales. */
  readonly causes: readonly CauseRef[];
  /** Deuda: el hogar acreedor (su interés va en contra de aflojarla). */
  readonly creditorHome?: string;
  /** Disputa: quién guarda cuánto rencor hacia el otro, por agente. */
  readonly resentment?: Readonly<Record<string, number>>;
}

export interface ScanEnv {
  readonly truth: ReadonlyWorldTruth;
  readonly ledger: ReadonlyLedger | undefined;
  readonly now: Tick;
  readonly day: Duration;
  readonly year: Duration;
  readonly goods: readonly GoodDef[];
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const round6 = (x: number): number => Math.round(x * 1e6) / 1e6;

export interface SettlementPeople {
  readonly homes: ReadonlyMap<string, readonly AgentId[]>;
}

/** Las presiones de una aldea, ordenadas por gravedad (desc) y por tipo y sujeto. */
export function scanPressures(
  env: ScanEnv,
  people: SettlementPeople,
  o: IssuesOptions,
): readonly PressureSignal[] {
  const { truth } = env;
  const out: PressureSignal[] = [];
  const famineDays = o.famineDays ?? 7;
  const floor = o.resentmentFloor ?? 0.5;
  const all = new Set<string>();
  const homeOf = new Map<string, string>();
  for (const [home, ms] of people.homes)
    for (const m of ms) {
      all.add(m);
      homeOf.set(m, home);
    }

  // Hambre: hogares con la despensa por debajo de los días de umbral (necesita ledger).
  if (env.ledger)
    for (const home of [...people.homes.keys()].sort()) {
      const flows = householdFlowsOf(
        truth,
        { goods: env.goods, ledger: env.ledger, now: env.now, day: env.day, year: env.year },
        home,
      );
      if (flows.pantryDays >= famineDays) continue;
      out.push({
        kind: "famine",
        subject: home,
        severity: round6(clamp01((famineDays - flows.pantryDays) / famineDays)),
        affected: people.homes.get(home) ?? [],
        affectedHomes: [home],
        causes: [{ kind: "state", entity: home as unknown as EntityRef, key: "pantry_days" }],
      });
    }

  // Deuda: préstamos caídos en mora entre hogares de la aldea.
  for (const id of [...truth.ids(LOANS)].sort()) {
    const l = truth.get(LOANS, id);
    if (l?.status !== "defaulted") continue;
    if (!people.homes.has(l.borrower) || !people.homes.has(l.lender)) continue;
    const due = totalDue(l);
    const owed = outstanding(l);
    if (owed <= 0 || due <= 0) continue;
    out.push({
      kind: "debt",
      subject: id as string,
      severity: round6(clamp01(owed / due)),
      affected: people.homes.get(l.borrower) ?? [],
      affectedHomes: [l.borrower],
      creditorHome: l.lender,
      causes: [{ kind: "state", entity: id as unknown as EntityRef, key: "defaulted" }],
    });
  }

  // Disputa: dos vecinos con rencor entre sí (el mayor de los dos sentidos).
  for (const a of [...all].sort()) {
    const rel = truth.get(RELATIONS, a as AgentId);
    if (!rel) continue;
    for (const b of Object.keys(rel.toward).sort()) {
      if (b <= a || !all.has(b)) continue;
      const ab = rel.toward[b]?.dims.resentment ?? 0;
      const ba = truth.get(RELATIONS, b as AgentId)?.toward[a]?.dims.resentment ?? 0;
      const worst = Math.max(ab, ba);
      if (worst < floor) continue;
      const hist = (ab >= ba ? rel.toward[b] : truth.get(RELATIONS, b as AgentId)?.toward[a])
        ?.history;
      const last = hist?.[hist.length - 1];
      out.push({
        kind: "dispute",
        subject: `${a}|${b}`,
        severity: round6(clamp01(worst)),
        affected: [a as AgentId, b as AgentId],
        affectedHomes: [],
        causes: [
          ...(last ? [{ kind: "event" as const, event: last }] : []),
          {
            kind: "state",
            entity: (ab >= ba ? a : b) as unknown as EntityRef,
            key: "resentment",
          },
        ],
        resentment: { [a]: ab, [b]: ba },
      });
    }
  }
  return out.sort(
    (x, y) =>
      y.severity - x.severity ||
      (x.kind < y.kind ? -1 : x.kind > y.kind ? 1 : 0) ||
      (x.subject < y.subject ? -1 : x.subject > y.subject ? 1 : 0),
  );
}

/** Lo cerca que está `who` de otro: cariño y trato, tal cual guardados. */
function closeness(truth: ReadonlyWorldTruth, who: AgentId, other: string): number {
  const d = truth.get(RELATIONS, who)?.toward[other]?.dims;
  return d ? clamp01(0.5 * Math.max(0, d.affection ?? 0) + 0.5 * (d.familiarity ?? 0)) : 0;
}

/** Cómo ve `who` (miembro del consejo) una presión: lo que le toca, lo cerca que está y su interés. */
export function memberView(
  truth: ReadonlyWorldTruth,
  who: AgentId,
  home: string | undefined,
  s: PressureSignal,
): MemberView {
  const party = s.affected.includes(who) || (home !== undefined && s.affectedHomes.includes(home));
  let near = 0;
  for (const x of s.affected) if (x !== who) near = Math.max(near, closeness(truth, who, x));
  let stake = 0;
  if (s.kind === "famine") stake = party ? 0.8 : -0.3 * (1 - near);
  else if (s.kind === "debt")
    stake = party ? 0.8 : home !== undefined && home === s.creditorHome ? -0.8 : 0;
  else if (s.kind === "dispute" && party) stake = (s.resentment?.[who] ?? 0) >= 0.5 ? -0.6 : 0.2;
  return {
    agent: who,
    affected: party,
    closeness: round6(near),
    stake,
    trustIn: (other) =>
      Math.min(1, Math.max(-1, truth.get(RELATIONS, who)?.toward[other]?.dims.trust ?? 0)),
  };
}

/** Lo que cada miembro percibe por sí de la presión. */
export function perceiveAll(
  truth: ReadonlyWorldTruth,
  members: readonly AgentId[],
  s: PressureSignal,
  rules: IssueRules,
): Map<AgentId, Perceived> {
  const out = new Map<AgentId, Perceived>();
  for (const who of members) {
    const home = truth.get(PERSON, who)?.household as string | undefined;
    const view = memberView(truth, who, home, s);
    const belief: IssueBelief | null = perceiveIssue(s.kind, s.subject, s.severity, view, rules);
    out.set(who, { view, belief });
  }
  return out;
}
