// Snapshot subjetivo para la meta finita de pagar compromisos conocidos. No consulta el ledger
// verdadero: recibe la proyección de DEBT_BOOK y solo acepta cierres respaldados por fuentes nuevas.

import { type AgentId, compareStrings, type EventId, isId, type Tick } from "../../core/index.ts";

export interface KnownDebtEvidence {
  readonly commitment: string;
  readonly role: "debtor" | "creditor";
  readonly other: AgentId;
  readonly remaining: number;
  readonly status: "active" | "fulfilled" | "defaulted" | "settled";
  readonly originEventId: EventId;
  readonly learnedAt: Tick;
  readonly confidence: number;
  readonly sources: readonly EventId[];
  /** Explicit payment observations reaching zero; generic `settled` may mean substitution. */
  readonly paidSources?: readonly EventId[];
}

export interface DebtGoalSnapshotEntry {
  readonly commitment: string;
  readonly origin: EventId;
  readonly sources: readonly EventId[];
  readonly paidSources: readonly EventId[];
}

export interface DebtGoalSnapshot {
  readonly other: AgentId;
  readonly bornAt: Tick;
  readonly entries: readonly DebtGoalSnapshotEntry[];
}

export interface DebtGoalCompletionEvidence {
  readonly commitment: string;
  readonly cause: EventId;
}

export interface DebtGoalCompletion {
  readonly at: Tick;
  /** Fuentes de pago/settlement citables por compromiso, en orden canónico. */
  readonly evidence: readonly DebtGoalCompletionEvidence[];
}

function validEvidence(item: KnownDebtEvidence, now: Tick): boolean {
  return (
    isId("commitment", item.commitment) &&
    isId("event", item.originEventId) &&
    item.learnedAt <= now &&
    Number.isFinite(item.remaining) &&
    item.remaining >= 0 &&
    Number.isFinite(item.confidence) &&
    item.confidence > 0 &&
    item.confidence <= 1 &&
    item.sources.every((source) => isId("event", source)) &&
    (item.paidSources ?? []).every(
      (source) => isId("event", source) && item.sources.includes(source),
    )
  );
}

/** Congela los compromisos que este agente conoce como deudor al nacer la meta mediana. */
export function debtGoalSnapshot(
  book: readonly KnownDebtEvidence[],
  other: AgentId,
  bornAt: Tick,
): DebtGoalSnapshot | undefined {
  const commitments = new Set<string>();
  for (const item of book) {
    if (item.other !== other || item.role !== "debtor") continue;
    if (commitments.has(item.commitment)) return undefined;
    commitments.add(item.commitment);
  }
  const entries = book
    .filter(
      (item) =>
        item.other === other &&
        item.role === "debtor" &&
        validEvidence(item, bornAt) &&
        item.remaining > 0 &&
        (item.status === "active" || item.status === "defaulted"),
    )
    .sort((a, b) => compareStrings(a.commitment, b.commitment))
    .map((item) => ({
      commitment: item.commitment,
      origin: item.originEventId,
      sources: [...new Set(item.sources)].sort(compareStrings),
      paidSources: [...new Set(item.paidSources ?? [])].sort(compareStrings),
    }));
  if (entries.length === 0) return undefined;
  return { other, bornAt, entries };
}

/** Cumple solo los compromisos congelados y con una fuente conocida posterior al snapshot. */
export function debtGoalCompletionFromEvidence(
  snapshot: DebtGoalSnapshot,
  book: readonly KnownDebtEvidence[],
  now: Tick,
): DebtGoalCompletion | undefined {
  if (snapshot.bornAt > now || snapshot.entries.length === 0) return undefined;
  const evidence: DebtGoalCompletionEvidence[] = [];
  for (const entry of snapshot.entries) {
    if (!isId("commitment", entry.commitment) || !isId("event", entry.origin)) return undefined;
    const matches = book.filter((item) => item.commitment === entry.commitment);
    if (matches.length !== 1) return undefined;
    const current = matches[0];
    if (
      current === undefined ||
      !validEvidence(current, now) ||
      current.other !== snapshot.other ||
      current.role !== "debtor" ||
      current.originEventId !== entry.origin ||
      current.learnedAt < snapshot.bornAt ||
      current.remaining !== 0 ||
      (current.status !== "fulfilled" && current.status !== "settled")
    )
      return undefined;
    const cause = [...new Set(current.paidSources ?? [])]
      .filter(
        (source) =>
          source !== entry.origin &&
          !entry.sources.includes(source) &&
          !entry.paidSources.includes(source),
      )
      .sort(compareStrings)[0];
    if (cause === undefined) return undefined;
    evidence.push({ commitment: entry.commitment, cause });
  }
  evidence.sort((a, b) => compareStrings(a.commitment, b.commitment));
  return { at: now, evidence };
}
