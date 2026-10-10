// El `Commitment` general (contracts §1, §2, §5, §6, §13): la forma común de deudas, vínculos,
// tratados y pactos. El préstamo de economy §8 es el primer tipo que lo usa: `loanToCommitment`
// lo expresa con base, partes, obligaciones, garantías y ejecutores sin tocar la cuenta del
// préstamo (la economía sigue siendo `LoanCommitment`; esto es su vista contractual). Todo puro,
// sin RNG ni reloj. La entrada es estructural para que contracts no dependa de economy.

export type CommitmentBasis = "agreement" | "norm" | "imposed";
export type CommitmentStatusKind = "active" | "fulfilled" | "defaulted" | "settled";
export type ObligationState = "pending" | "partial" | "fulfilled" | "defaulted";

export interface CommitmentParty {
  readonly ref: string;
  readonly role: string;
}

export type CommitmentDuty = {
  readonly kind: "deliver";
  readonly unit: string;
  readonly qty: number;
};

export interface CommitmentObligation {
  readonly id: string;
  readonly debtor: string;
  readonly creditor: string;
  readonly duty: CommitmentDuty;
  /** Día de mundo en que vence. */
  readonly dueDay: number;
  readonly state: ObligationState;
  /** Lo ya cumplido de `duty.qty`. */
  readonly performed: number;
}

export type CommitmentGuarantee =
  | {
      readonly kind: "collateral";
      readonly ref: string;
      readonly held: "creditor" | "debtor" | "third";
    }
  | { readonly kind: "guarantor"; readonly agent: string; readonly share: number };

export type EnforcerKind =
  | "conscience"
  | "counterparty"
  | "social"
  | "organization"
  | "court"
  | "guarantee"
  | "karmic"
  | "binding"
  | "patron";

/** Qué ejecutores existen en este mundo y para esta cultura (el mundo decide, §6). */
export interface EnforcerRef {
  readonly kind: EnforcerKind;
  /** Quién: la aldea, el magistrado, el clan. */
  readonly who?: string;
  /** Qué lee para actuar: casi todos creencias; el Cielo y las ataduras, la verdad. */
  readonly reads: "belief" | "truth";
}

export interface Commitment {
  readonly id: string;
  readonly kind: string;
  readonly basis: CommitmentBasis;
  readonly parties: readonly CommitmentParty[];
  readonly obligations: readonly CommitmentObligation[];
  readonly guarantees: readonly CommitmentGuarantee[];
  readonly enforcers: readonly EnforcerRef[];
  readonly status: CommitmentStatusKind;
  readonly term: { readonly startDay: number; readonly endDay: number };
  /** Renegociación, cesión o derivado (el fiador que paga queda como acreedor, §5). */
  readonly parent?: string;
  readonly originEventId: string;
  readonly history: readonly string[];
}

/** Lo que `LoanCommitment` (economy) entrega: forma estructural, sin importar el módulo. */
export interface LoanLike {
  readonly id: string;
  readonly lender: string;
  readonly borrower: string;
  readonly unit: string;
  readonly principal: number;
  readonly rate: number;
  readonly startDay: number;
  readonly dueDay: number;
  readonly lenderAccount: string;
  readonly collateral: readonly { readonly ref: string; readonly heldBy: string }[];
  readonly guarantors: readonly { readonly id: string; readonly share: number }[];
  readonly paid: number;
  readonly status: "active" | "repaid" | "defaulted" | "settled";
  readonly originEventId: string;
}

/** Qué ejecutores hay donde vive el préstamo (los fija la cultura y el mundo, no el préstamo). */
export interface EnforcementContext {
  /** La comunidad que se entera de quién no paga (fama). */
  readonly community?: string;
  /** Hay tribunal o magistrado que reconoce la deuda. */
  readonly court?: string;
  /** Clan u organización que respalda al acreedor. */
  readonly organization?: string;
  /** El mundo tiene Cielo que lleva cuenta de los compromisos. */
  readonly karma?: boolean;
}

/** Los ejecutores de un préstamo, en orden estable. Siempre están la conciencia y la contraparte. */
export function loanEnforcers(
  l: Pick<LoanLike, "guarantors" | "collateral">,
  ctx: EnforcementContext = {},
): EnforcerRef[] {
  const out: EnforcerRef[] = [
    { kind: "conscience", reads: "belief" },
    { kind: "counterparty", reads: "belief" },
  ];
  if (ctx.community !== undefined)
    out.push({ kind: "social", who: ctx.community, reads: "belief" });
  if (ctx.organization !== undefined)
    out.push({ kind: "organization", who: ctx.organization, reads: "belief" });
  if (ctx.court !== undefined) out.push({ kind: "court", who: ctx.court, reads: "belief" });
  if (l.collateral.length > 0 || l.guarantors.length > 0)
    out.push({ kind: "guarantee", reads: "truth" });
  if (ctx.karma === true) out.push({ kind: "karmic", reads: "truth" });
  return out;
}

const loanState = (l: LoanLike, owed: number): ObligationState =>
  l.status === "defaulted"
    ? "defaulted"
    : owed <= 0
      ? "fulfilled"
      : l.paid > 0
        ? "partial"
        : "pending";

/**
 * El préstamo como `Commitment`: base `agreement` (o `imposed` si lo pidió la fuerza), una
 * obligación del deudor (principal más interés simple, la misma cuenta que `totalDue`), el
 * prestamista ya cumplió al desembolsar (no figura como deuda), garantías y ejecutores.
 */
export function loanToCommitment(
  l: LoanLike,
  opts: { readonly basis?: CommitmentBasis; readonly enforcement?: EnforcementContext } = {},
): Commitment {
  const total = l.principal + Math.round(l.principal * l.rate);
  const owed = Math.max(0, total - l.paid);
  const guarantees: CommitmentGuarantee[] = [
    ...l.collateral.map(
      (c): CommitmentGuarantee => ({
        kind: "collateral",
        ref: c.ref,
        held: c.heldBy === l.lenderAccount ? "creditor" : "debtor",
      }),
    ),
    ...l.guarantors.map(
      (g): CommitmentGuarantee => ({ kind: "guarantor", agent: g.id, share: g.share }),
    ),
  ];
  const status: CommitmentStatusKind =
    l.status === "active"
      ? "active"
      : l.status === "repaid"
        ? "fulfilled"
        : l.status === "defaulted"
          ? "defaulted"
          : "settled";
  return {
    id: l.id,
    kind: "loan",
    basis: opts.basis ?? "agreement",
    parties: [
      { ref: l.lender, role: "lender" },
      { ref: l.borrower, role: "borrower" },
    ],
    obligations: [
      {
        id: `${l.id}#repay`,
        debtor: l.borrower,
        creditor: l.lender,
        duty: { kind: "deliver", unit: l.unit, qty: total },
        dueDay: l.dueDay,
        state: loanState(l, owed),
        performed: Math.min(total, l.paid),
      },
    ],
    guarantees,
    enforcers: loanEnforcers(l, opts.enforcement),
    status,
    term: { startDay: l.startDay, endDay: l.dueDay },
    originEventId: l.originEventId,
    history: [],
  };
}

/** Lo que falta de la obligación de devolver (coincide con `outstanding` de economy). */
export function commitmentOwed(c: Commitment): number {
  let owed = 0;
  for (const o of c.obligations) owed += Math.max(0, o.duty.qty - o.performed);
  return owed;
}

/**
 * El fiador que pagó (§5): un compromiso derivado donde el deudor original le debe lo que
 * puso, con `parent` en el préstamo. El interés no se acumula: es la misma unidad, tal cual.
 */
export function guarantorSubrogation(
  parent: Commitment,
  guarantor: string,
  amount: number,
  id: string,
  originEventId: string,
  day: number,
): Commitment | undefined {
  const base = parent.obligations[0];
  if (!base || amount <= 0) return undefined;
  return {
    id,
    kind: "subrogation",
    basis: "norm",
    parties: [
      { ref: guarantor, role: "creditor" },
      { ref: base.debtor, role: "debtor" },
    ],
    obligations: [
      {
        id: `${id}#repay`,
        debtor: base.debtor,
        creditor: guarantor,
        duty: { kind: "deliver", unit: base.duty.unit, qty: amount },
        dueDay: day,
        state: "pending",
        performed: 0,
      },
    ],
    guarantees: [],
    enforcers: parent.enforcers.filter((e) => e.kind !== "guarantee"),
    status: "active",
    term: { startDay: day, endDay: day },
    parent: parent.id,
    originEventId,
    history: [],
  };
}
