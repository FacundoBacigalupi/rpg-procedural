// Instrumentación de tooling: sólo lee libros/decisiones y audita sus fuentes contra el log.
import { type AgentId, compareStrings, type Event, type Tick } from "../../core/index.ts";
import { believedDebtRatio, DEBT_BOOK, NPC_DECISION, NPC_GOALS } from "../../game/index.ts";
import { ENTITY, LAYER_PULL, type ReadonlyWorldTruth } from "../../sim/index.ts";

export interface GoalSample {
  readonly at: Tick;
  readonly decisions: number;
  readonly byVerb: Readonly<Record<string, number>>;
  readonly withDebtByVerb: Readonly<Record<string, number>>;
  readonly utilitySum: number;
  readonly optionsSum: number;
  readonly bookHolders: number;
  readonly activeDebts: number;
  readonly ratioSum: number;
  readonly invalidBeliefs: number;
  readonly goalsByLayer: Readonly<Record<string, number>>;
  readonly missingSources: number;
  readonly futureSources: number;
}

const sorted = (counts: Map<string, number>) =>
  Object.fromEntries([...counts].sort(([a], [b]) => compareStrings(a, b)));
const add = (counts: Map<string, number>, key: string) =>
  counts.set(key, (counts.get(key) ?? 0) + 1);
const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** Nueva decisión en (since,now]; no contar cada día una decisión vieja de un NPC dormido. */
export function sampleGoalMetrics(
  truth: ReadonlyWorldTruth,
  events: readonly Event[],
  since: Tick,
  now: Tick,
): GoalSample {
  const byVerb = new Map<string, number>();
  const withDebtByVerb = new Map<string, number>();
  const goalsByLayer = new Map<string, number>();
  const known = new Map(events.map((e) => [e.id, e]));
  let decisions = 0,
    utilitySum = 0,
    optionsSum = 0,
    bookHolders = 0,
    activeDebts = 0,
    ratioSum = 0,
    invalidBeliefs = 0,
    missingSources = 0,
    futureSources = 0;
  for (const id of truth.ids(ENTITY)) {
    if (!id.startsWith("agent:") || truth.get(ENTITY, id)?.endedAt !== undefined) continue;
    const who = id as AgentId;
    const book = truth.get(DEBT_BOOK, who);
    if (book) bookHolders++;
    let hasDebt = false;
    for (const b of book?.items ?? []) {
      for (const source of new Set([b.originEventId, ...b.sources])) {
        const e = known.get(source);
        if (!e) missingSources++;
        else if (e.tick > b.learnedAt) futureSources++;
      }
      const ratio = believedDebtRatio(b) * Math.min(1, Math.max(0, b.confidence ?? 1));
      if (!Number.isFinite(ratio)) {
        invalidBeliefs++;
        continue;
      }
      if (ratio > 0) {
        activeDebts++;
        ratioSum += ratio;
        hasDebt = true;
      }
    }
    for (const goal of truth.get(NPC_GOALS, who)?.items ?? []) add(goalsByLayer, goal.layer);
    const decision = truth.get(NPC_DECISION, who);
    if (
      !decision ||
      decision.at <= since ||
      decision.at > now ||
      !Number.isFinite(decision.utility) ||
      !Number.isFinite(decision.options)
    )
      continue;
    decisions++;
    utilitySum += decision.utility;
    optionsSum += decision.options;
    add(byVerb, decision.verb);
    if (hasDebt) add(withDebtByVerb, decision.verb);
  }
  return {
    at: now,
    decisions,
    byVerb: sorted(byVerb),
    withDebtByVerb: sorted(withDebtByVerb),
    utilitySum,
    optionsSum,
    bookHolders,
    activeDebts,
    ratioSum,
    invalidBeliefs,
    goalsByLayer: sorted(goalsByLayer),
    missingSources,
    futureSources,
  };
}

export interface GoalMetrics {
  readonly samples: number;
  readonly decisions: number;
  readonly byVerb: Readonly<Record<string, number>>;
  readonly withDebtByVerb: Readonly<Record<string, number>>;
  readonly meanUtility: number;
  readonly meanOptions: number;
  readonly finalBookHolders: number;
  readonly finalActiveDebts: number;
  readonly activeDebtSamples: number;
  readonly meanDebtRatio: number;
  readonly finalMeanDebtRatio: number;
  readonly invalidBeliefs: number;
  readonly finalGoalsByLayer: Readonly<Record<string, number>>;
  readonly bornByLayer: Readonly<Record<string, number>>;
  readonly endedByLayer: Readonly<Record<string, number>>;
  readonly finalMissingSources: number;
  readonly finalFutureSources: number;
  readonly missingGoalCauses: number;
  readonly invalidGoalCauses: number;
  readonly layerPull: typeof LAYER_PULL;
}

/** Incluye sólo eventos del período medido; las fuentes pueden ser de la historia previa. */
export function summarizeGoalMetrics(
  samples: readonly GoalSample[],
  events: readonly Event[],
  from: Tick,
  to: Tick,
): GoalMetrics {
  const byVerb = new Map<string, number>();
  const withDebtByVerb = new Map<string, number>();
  const born = new Map<string, number>();
  const ended = new Map<string, number>();
  const known = new Map(events.map((e) => [e.id, e]));
  let decisions = 0,
    utilitySum = 0,
    optionsSum = 0,
    invalidBeliefs = 0,
    missingGoalCauses = 0,
    invalidGoalCauses = 0;
  let activeDebtSamples = 0;
  let ratioSum = 0;
  for (const s of samples) {
    activeDebtSamples += s.activeDebts;
    ratioSum += s.ratioSum;
    decisions += s.decisions;
    utilitySum += s.utilitySum;
    optionsSum += s.optionsSum;
    invalidBeliefs += s.invalidBeliefs;
    for (const [k, v] of Object.entries(s.byVerb)) byVerb.set(k, (byVerb.get(k) ?? 0) + v);
    for (const [k, v] of Object.entries(s.withDebtByVerb))
      withDebtByVerb.set(k, (withDebtByVerb.get(k) ?? 0) + v);
  }
  for (const e of events) {
    if (e.kind !== "npc.goal" || e.tick <= from || e.tick > to) continue;
    const d = record(e.data);
    if (typeof d?.["layer"] === "string") {
      if (d["what"] === "born") add(born, d["layer"]);
      else if (d["what"] === "ended") add(ended, d["layer"]);
    }
    if (!e.causes.some((c) => c.kind === "event")) missingGoalCauses++;
    for (const c of e.causes)
      if (c.kind === "event") {
        const source = known.get(c.event);
        if (!source || source.tick > e.tick) invalidGoalCauses++;
      }
  }
  const last = samples[samples.length - 1];
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  return {
    samples: samples.length,
    decisions,
    byVerb: sorted(byVerb),
    withDebtByVerb: sorted(withDebtByVerb),
    meanUtility: decisions > 0 ? round(utilitySum / decisions) : 0,
    meanOptions: decisions > 0 ? round(optionsSum / decisions) : 0,
    finalBookHolders: last?.bookHolders ?? 0,
    finalActiveDebts: last?.activeDebts ?? 0,
    activeDebtSamples,
    meanDebtRatio: activeDebtSamples > 0 ? round(ratioSum / activeDebtSamples) : 0,
    finalMeanDebtRatio: last && last.activeDebts > 0 ? round(last.ratioSum / last.activeDebts) : 0,
    invalidBeliefs,
    finalGoalsByLayer: last?.goalsByLayer ?? {},
    bornByLayer: sorted(born),
    endedByLayer: sorted(ended),
    finalMissingSources: last?.missingSources ?? 0,
    finalFutureSources: last?.futureSources ?? 0,
    missingGoalCauses,
    invalidGoalCauses,
    layerPull: LAYER_PULL,
  };
}
