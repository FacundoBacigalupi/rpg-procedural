// Préstamos de cosecha cableados a la vida (economy §8). Explícitos: sin `LoanSeed` no hay filas,
// ni eventos, ni RNG, así que la aldea por defecto no cambia. Una semilla es un préstamo ya
// decidido (prestamista, deudor, principal, tasa, plazo, colateral, fiadores); al llegar su día el
// proceso diario lo abre con el evento `credit.loaned` (causa: la semilla, estado del hogar
// prestamista), desembolsa por el ledger y crea la entidad `commitment:N` con `LOANS`. Cada día
// el deudor paga la cuota con lo que tiene (`credit.paid`); al vencer lo impago se ejecuta
// (`credit.defaulted`): colateral por su valor real, después fiadores por el ledger. Todo se
// conserva: el interés sale de lo que produce el deudor y la pérdida del prestamista no se cubre.

import {
  type AgentId,
  type EntityRef,
  type HolderRef,
  holderAccount,
  type LedgerAccount,
  ledgerUnit,
  type PlaceRef,
  type PlanetClock,
  type Transfer,
} from "../../core/index.ts";
import {
  type Collateral,
  type Commitment,
  draftEvent,
  ENTITY,
  type EnforcementContext,
  type EventDraft,
  executeDefault,
  type GoodDef,
  type Guarantor,
  goodUnit,
  guarantorSubrogation,
  installmentPerDay,
  type LoanCommitment,
  loanToCommitment,
  makeLoan,
  outstanding,
  PARCEL,
  type Parcel,
  PERSON,
  type PostingDraft,
  type ProcessDef,
  payLoan,
  type ReadonlyWorldTruth,
  type StateChange,
  setComponent,
  table,
} from "../../sim/index.ts";

export const LOANS_PROCESS = "life.loans";

/** El préstamo guardado: el compromiso económico y la semilla de la que nació. */
export type LoanRow = LoanCommitment & { readonly seed: string };
/** Cada préstamo vive en una entidad `commitment:n` con este componente. */
export const LOANS = table<LoanRow>("economy.loans");
/**
 * La vista contractual de cada préstamo (contracts §1) y las subrogaciones de los fiadores que
 * pagaron (§5), con la misma clave `commitment:N`. Solo la escribe el proceso de préstamos.
 */
export const COMMITMENTS = table<Commitment>("contracts.commitment");

/** Un préstamo decidido de antemano: la única fuente de préstamos hasta que los hogares apretados los pidan. */
export interface LoanSeed {
  readonly id: string;
  /** Hogar prestamista y hogar deudor. */
  readonly lender: string;
  readonly borrower: string;
  /** Bien del principal (`grain`, una moneda…). */
  readonly good: string;
  readonly principal: number;
  /** Interés simple por plazo. */
  readonly rate: number;
  /** Día del mundo en que se abre y días hasta el vencimiento. */
  readonly startDay: number;
  readonly termDays: number;
  /**
   * Prendas. Con `lot` la prenda es un lote de bienes sueltos del ledger (unidad y cantidad): al
   * ejecutarse pasa de la cuenta de quien la tiene a la del prestamista, tope lo que haya (traspaso).
   */
  readonly collateral?: readonly (Omit<Collateral, "heldBy"> & {
    readonly heldBy: string;
    readonly lot?: { readonly unit: string; readonly amount: number };
  })[];
  readonly guarantors?: readonly { readonly household: string; readonly share: number }[];
}

export interface LoansOptions {
  readonly clock: PlanetClock;
  readonly goods: readonly GoodDef[];
  readonly seeds: readonly LoanSeed[];
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
  /** Qué ejecutores hay en este mundo (comunidad, tribunal, clan, Cielo); por defecto solo conciencia y contraparte. */
  readonly enforcement?: EnforcementContext;
}

export function commitmentRows(
  truth: ReadonlyWorldTruth,
): { id: string; commitment: Commitment }[] {
  return [...truth.ids(COMMITMENTS)]
    .sort()
    .map((id) => ({ id: id as string, commitment: truth.get(COMMITMENTS, id) as Commitment }));
}

export function loanRows(truth: ReadonlyWorldTruth): { id: string; loan: LoanRow }[] {
  return [...truth.ids(LOANS)]
    .sort()
    .map((id) => ({ id: id as string, loan: truth.get(LOANS, id) as LoanRow }));
}

/** Los préstamos activos de un hogar deudor (para `withLoanPayments`). */
export function loansOf(truth: ReadonlyWorldTruth, borrowerAccount: LedgerAccount): LoanRow[] {
  const out: LoanRow[] = [];
  for (const id of truth.ids(LOANS)) {
    const l = truth.get(LOANS, id);
    if (l && l.status === "active" && l.borrowerAccount === borrowerAccount) out.push(l);
  }
  return out;
}

const acct = (home: string): LedgerAccount => holderAccount(home as unknown as HolderRef);

export function loansProcess(o: LoansOptions): ProcessDef {
  const goodDef = new Map(o.goods.map((g) => [g.id, g]));
  const enf = o.enforcement ? { enforcement: o.enforcement } : {};
  return {
    id: LOANS_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "act",
    reads: [PERSON.name, ENTITY.name, LOANS.name, COMMITMENTS.name, PARCEL.name],
    writes: [LOANS.name, COMMITMENTS.name, ENTITY.name, PARCEL.name],
    run(ctx) {
      const ledger = ctx.ledger;
      if (!ledger || o.seeds.length === 0) return {};
      const today = Math.floor(ctx.now / o.clock.day);

      const firstAlive = (home: string): AgentId | undefined => {
        for (const id of [...ctx.truth.ids(PERSON)].sort()) {
          if (ctx.truth.get(PERSON, id)?.household !== home) continue;
          if (ctx.truth.get(ENTITY, id)?.endedAt === undefined) return id as AgentId;
        }
        return undefined;
      };
      const delta = new Map<string, number>();
      const key = (a: LedgerAccount, u: string) => `${a}|${u}`;
      const bal = (a: LedgerAccount, u: string) =>
        (ledger.balance(a, u as never) ?? 0) + (delta.get(key(a, u)) ?? 0);
      const apply = (ts: readonly Transfer[]) => {
        for (const t of ts) {
          delta.set(key(t.from, t.unit), (delta.get(key(t.from, t.unit)) ?? 0) - t.amount);
          delta.set(key(t.to, t.unit), (delta.get(key(t.to, t.unit)) ?? 0) + t.amount);
        }
      };

      const events: EventDraft[] = [];
      const postings: PostingDraft[] = [];
      const changes: StateChange[] = [];
      const rows = loanRows(ctx.truth);
      const known = new Set(rows.map((r) => r.loan.seed));

      // Abrir: las semillas cuyo día llegó y que todavía no son préstamo.
      const opened: { id: string; loan: LoanRow }[] = [];
      for (const s of [...o.seeds].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
        if (known.has(s.id) || s.startDay > today) continue;
        const def = goodDef.get(s.good);
        const lenderMan = firstAlive(s.lender);
        const borrowerMan = firstAlive(s.borrower);
        if (!def || !lenderMan || !borrowerMan) continue;
        const unit = goodUnit(def);
        if (bal(acct(s.lender), unit) < s.principal) continue;
        const id = ctx.newId("commitment");
        const k = events.length;
        const loan = makeLoan({
          id,
          lender: s.lender,
          borrower: s.borrower,
          lenderAccount: acct(s.lender),
          borrowerAccount: acct(s.borrower),
          unit,
          requested: s.principal,
          rate: s.rate,
          startDay: today,
          dueDay: today + s.termDays,
          collateral: (s.collateral ?? []).map(({ lot: _lot, ...c }) => ({
            ...c,
            heldBy: acct(c.heldBy),
          })),
          guarantors: (s.guarantors ?? []).map(
            (g): Guarantor => ({ id: g.household, account: acct(g.household), share: g.share }),
          ),
          unsecuredLimit: s.principal,
          originEventId: draftEvent(k),
        });
        if (!loan) continue;
        const row: LoanRow = { ...loan, seed: s.id };
        events.push({
          kind: "credit.loaned",
          actors: [lenderMan, borrowerMan],
          place: o.placeOf(ctx.truth, lenderMan),
          data: {
            loan: id,
            seed: s.id,
            unit,
            principal: row.principal,
            rate: row.rate,
            dueDay: row.dueDay,
          },
          emissions: {},
          causes: [
            { kind: "state", entity: s.lender as unknown as EntityRef, key: `loan-seed:${s.id}` },
          ],
        });
        const ts = [
          { unit, from: row.lenderAccount, to: row.borrowerAccount, amount: row.principal },
        ];
        postings.push({ event: draftEvent(k), transfers: ts });
        apply(ts);
        changes.push(
          setComponent(
            ENTITY,
            id as never,
            {
              id,
              originEventId: draftEvent(k),
              createdAt: ctx.now,
            } as never,
          ),
          setComponent(LOANS, id as never, row),
          setComponent(COMMITMENTS, id as never, loanToCommitment(row, enf)),
        );
        opened.push({ id: id as string, loan: row });
      }

      // Cobrar o ejecutar: los activos de antes (los recién abiertos empiezan mañana).
      for (const r of rows) {
        const l = r.loan;
        if (l.status !== "active") continue;
        const lenderMan = firstAlive(l.lender);
        const borrowerMan = firstAlive(l.borrower);
        if (!lenderMan || !borrowerMan) continue;
        const cause = [
          { kind: "event" as const, event: l.originEventId as never },
          { kind: "state" as const, entity: r.id as unknown as EntityRef, key: "loan" },
        ];
        if (today >= l.dueDay) {
          const holds = new Map(l.guarantors.map((g) => [g.id, bal(g.account, l.unit)]));
          const res = executeDefault(l, today, holds);
          const k = events.length;
          events.push({
            kind: "credit.defaulted",
            actors: [borrowerMan, lenderMan],
            place: o.placeOf(ctx.truth, lenderMan),
            data: {
              loan: r.id,
              owed: outstanding(l),
              loss: res.loss,
              status: res.loan.status,
              seized: res.seized.map((s) => s.ref),
              released: res.released,
              guarantorsPaid: res.guarantorsPaid,
            },
            emissions: {},
            causes: cause,
          });
          // Lotes en prenda: lo que hay (tope el saldo) pasa por el ledger a la cuenta del prestamista.
          const seedOf = o.seeds.find((x) => x.id === l.seed);
          const lotTransfers: Transfer[] = [];
          for (const sz of res.seized) {
            const lot = seedOf?.collateral?.find((c) => c.ref === sz.ref)?.lot;
            if (!lot || sz.from === sz.to) continue;
            const unit = ledgerUnit(lot.unit);
            const amount = Math.min(Math.floor(lot.amount), Math.floor(bal(sz.from, unit)));
            if (amount <= 0) continue;
            const t = { unit, from: sz.from, to: sz.to, amount };
            lotTransfers.push(t);
            apply([t]);
          }
          const all = [...res.transfers, ...lotTransfers];
          if (res.transfers.length > 0) apply(res.transfers);
          if (all.length > 0) postings.push({ event: draftEvent(k), transfers: all });
          // La tenencia real: la tierra dada en prenda pasa de casa; los lotes ya viajaron por ledger.
          const parcels = new Map<string, Parcel>();
          for (const sz of res.seized) {
            const p = parcels.get(sz.ref) ?? ctx.truth.get(PARCEL, sz.ref as never);
            if (!p?.rights.some((rt) => (rt.holder as string) === l.borrower)) continue;
            const record = {
              kind: "custom" as const,
              witnesses: [borrowerMan, lenderMan],
              event: draftEvent(k) as never,
            };
            parcels.set(sz.ref, {
              ...p,
              rights: p.rights.map((rt) =>
                (rt.holder as string) === l.borrower
                  ? { ...rt, holder: l.lender as never, record }
                  : rt,
              ),
              possession:
                (p.possession as string | null) === l.borrower ? (l.lender as never) : p.possession,
            });
          }
          for (const [ref, p] of parcels) changes.push(setComponent(PARCEL, ref as never, p));
          // La mora con pérdida es una deuda sin pagar: alimenta la fama igual que el fiado.
          if (res.loan.status === "defaulted") {
            events.push({
              kind: "law.default",
              actors: [borrowerMan, lenderMan],
              place: o.placeOf(ctx.truth, lenderMan),
              data: { credit: r.id, unit: l.unit, owed: res.loss },
              emissions: {},
              causes: [{ kind: "event" as const, event: draftEvent(k) as never }],
            });
          }
          const next: LoanRow = { ...res.loan, seed: l.seed };
          const parent = loanToCommitment(next, enf);
          changes.push(
            setComponent(LOANS, r.id as never, next),
            setComponent(COMMITMENTS, r.id as never, {
              ...parent,
              history: [...parent.history, "credit.defaulted"],
            }),
          );
          // El fiador que pagó queda como acreedor del deudor (subrogación, contracts §5).
          for (const gp of res.guarantorsPaid) {
            const sid = ctx.newId("commitment");
            const sub = guarantorSubrogation(
              parent,
              gp.id,
              gp.amount,
              sid as string,
              draftEvent(k) as unknown as string,
              today,
            );
            if (!sub) continue;
            changes.push(
              setComponent(
                ENTITY,
                sid as never,
                { id: sid, originEventId: draftEvent(k), createdAt: ctx.now } as never,
              ),
              setComponent(COMMITMENTS, sid as never, sub),
            );
          }
          continue;
        }
        const due = Math.ceil(installmentPerDay(l, today));
        const pay = payLoan(l, due, bal(l.borrowerAccount, l.unit));
        if (pay.paid <= 0) continue;
        const k = events.length;
        events.push({
          kind: "credit.paid",
          actors: [borrowerMan, lenderMan],
          place: o.placeOf(ctx.truth, borrowerMan),
          data: { loan: r.id, paid: pay.paid, status: pay.loan.status },
          emissions: {},
          causes: cause,
        });
        postings.push({ event: draftEvent(k), transfers: pay.transfers });
        apply(pay.transfers);
        const paidRow: LoanRow = { ...pay.loan, seed: l.seed };
        changes.push(
          setComponent(LOANS, r.id as never, paidRow),
          setComponent(COMMITMENTS, r.id as never, loanToCommitment(paidRow, enf)),
        );
      }

      if (events.length === 0) return {};
      return { events, postings, changes };
    },
  };
}
