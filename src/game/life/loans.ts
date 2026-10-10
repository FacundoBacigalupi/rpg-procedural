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
  bondageDebtLeft,
  bondageExpired,
  type Collateral,
  type Commitment,
  current,
  type DecayContext,
  draftEvent,
  ENTITY,
  type EnforcementContext,
  type EventDraft,
  endBondage,
  executeDefault,
  type GoodDef,
  type Guarantor,
  goodUnit,
  guarantorSubrogation,
  installmentPerDay,
  type LoanCommitment,
  loanToCommitment,
  makeBondage,
  makeLoan,
  outstanding,
  PARCEL,
  type Parcel,
  PERSON,
  type PostingDraft,
  type ProcessDef,
  payLoan,
  RELATIONS,
  type ReadonlyWorldTruth,
  type Relationship,
  type StateChange,
  setComponent,
  table,
  workBondageDay,
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
  /**
   * Opt-in: con `enforcement.community`, al caer en mora con pérdida el acreedor reclama ante la
   * comunidad (`credit.claimed`) y los vecinos que le creen más a él se enteran (fama del moroso).
   */
  readonly communityClaim?: boolean;
  /**
   * Opt-in: el fiador subrogado (`kind: "subrogation"`) cobra al deudor original, cada día una cuota
   * (`SUBROGATION_DAYS` días de plazo) con lo que el deudor tenga, por el ledger (`credit.subrogated_paid`).
   */
  readonly repaySubrogation?: boolean;
  /**
   * Opt-in: con `enforcement.court` / `enforcement.organization`, esos ejecutores reclaman la deuda
   * (`credit.claimed` con `enforcer`) si lo que cree la gente de su alcance los respalda (`enforcerStands`).
   */
  readonly enforcerClaims?: boolean;
  /**
   * Opt-in: la mora con pérdida abre una servidumbre (`bondage`, `parent` = el préstamo) donde el
   * deudor trabaja para el acreedor y cada día abona `wagePerDay - upkeepPerDay` de lo perdido
   * (`credit.bonded`, `credit.bondage_worked`). Termina `paid`, `term` o `escape` (si el abono es 0,
   * a mitad de plazo el deudor huye). Sin esto no hay filas, eventos ni RNG nuevos.
   */
  readonly bondage?: BondageTerms;
  /** Opt-in: la confianza de RELATIONS se lee con `current` (decaimiento al día de hoy); sin esto, tal cual está guardada. */
  readonly relationDecay?: DecayContext;
}

/** Condiciones de la servidumbre por deudas (en la unidad del préstamo; sin calibrar). */
export interface BondageTerms {
  readonly wagePerDay: number;
  readonly upkeepPerDay: number;
  readonly maxDays: number;
  /**
   * Opt-in: un conocido del deudor (confianza > 0 hacia él, otro hogar) con saldo suficiente paga lo
   * que falta por el ledger al acreedor (`end: "ransom"`, `credit.bondage_ended` con `ransomer`).
   */
  readonly ransom?: boolean;
  /**
   * Opt-in: cada día el acreedor rompe el trato con probabilidad `chance(truth, acreedor)` (la que
   * dé su temperamento y su cultura, calculada afuera); el deudor queda libre (`end: "abuse"`) y los
   * vecinos que confiaban en el acreedor le restan `reputationCost` de confianza.
   */
  readonly abuse?: {
    readonly chance: (truth: ReadonlyWorldTruth, creditor: AgentId) => number;
    readonly reputationCost: number;
  };
}

/** Confianza de `rel` al tick `now`: con decaimiento si hay contexto, sin él tal cual. */
export function trustNow(rel: Relationship | undefined, now: number, decay?: DecayContext): number {
  if (!rel) return 0;
  return (decay ? current(rel, now, decay) : rel).dims.trust ?? 0;
}

/**
 * Pura: un ejecutor que lee creencias respalda al acreedor si, entre quienes tienen opinión
 * (confianza distinta de cero en alguno de los dos), al menos `threshold` (0-1) le creen más a él.
 */
export function enforcerStands(
  views: readonly { readonly lender: number; readonly borrower: number }[],
  threshold = 0.5,
): boolean {
  const opined = views.filter((v) => v.lender !== 0 || v.borrower !== 0);
  if (opined.length === 0) return false;
  const pro = opined.filter((v) => v.lender > v.borrower).length;
  return pro / opined.length >= threshold;
}

/** En cuántos días el deudor original devuelve al fiador lo que este puso (constante sin calibrar). */
export const SUBROGATION_DAYS = 30;

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
    reads: [PERSON.name, ENTITY.name, LOANS.name, COMMITMENTS.name, PARCEL.name, RELATIONS.name],
    writes: [
      LOANS.name,
      COMMITMENTS.name,
      ENTITY.name,
      PARCEL.name,
      ...(o.bondage?.abuse ? [RELATIONS.name] : []),
    ],
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
          // Ejecutor social (contracts §6): el acreedor reclama ante la comunidad, y solo lo oyen los
          // vecinos que en su cabeza (RELATIONS: confianza) le creen más a él que al moroso.
          if (res.loan.status === "defaulted" && o.communityClaim && o.enforcement?.community) {
            const listeners = [...ctx.truth.ids(PERSON)].sort().filter((id) => {
              const p = ctx.truth.get(PERSON, id);
              if (!p || p.household === l.lender || p.household === l.borrower) return false;
              if (ctx.truth.get(ENTITY, id)?.endedAt !== undefined) return false;
              const toward = ctx.truth.get(RELATIONS, id)?.toward;
              const trustIn = (who: AgentId) =>
                trustNow(toward?.[who as string], ctx.now, o.relationDecay);
              return trustIn(lenderMan) > trustIn(borrowerMan);
            }) as AgentId[];
            if (listeners.length > 0) {
              events.push({
                kind: "credit.claimed",
                actors: [borrowerMan, lenderMan],
                place: o.placeOf(ctx.truth, lenderMan),
                data: {
                  loan: r.id,
                  community: o.enforcement.community,
                  owed: res.loss,
                  noticedBy: listeners,
                },
                emissions: {},
                causes: [{ kind: "event" as const, event: draftEvent(k) as never }],
              });
            }
          }
          // Tribunal y clan/organización (contracts §6): reclaman si la gente que los rodea le cree al acreedor.
          if (res.loan.status === "defaulted" && o.enforcerClaims && o.enforcement) {
            const views = [...ctx.truth.ids(PERSON)]
              .sort()
              .filter((id) => {
                const p = ctx.truth.get(PERSON, id);
                if (!p || p.household === l.lender || p.household === l.borrower) return false;
                return ctx.truth.get(ENTITY, id)?.endedAt === undefined;
              })
              .map((id) => {
                const toward = ctx.truth.get(RELATIONS, id)?.toward;
                return {
                  lender: trustNow(toward?.[lenderMan as string], ctx.now, o.relationDecay),
                  borrower: trustNow(toward?.[borrowerMan as string], ctx.now, o.relationDecay),
                };
              });
            for (const [kind, who] of [
              ["organization", o.enforcement.organization],
              ["court", o.enforcement.court],
            ] as const) {
              if (who === undefined || !enforcerStands(views)) continue;
              events.push({
                kind: "credit.claimed",
                actors: [borrowerMan, lenderMan],
                place: o.placeOf(ctx.truth, lenderMan),
                data: { loan: r.id, enforcer: { kind, who }, owed: res.loss },
                emissions: {},
                causes: [{ kind: "event" as const, event: draftEvent(k) as never }],
              });
            }
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
          // Servidumbre (contracts §2): lo que no se cobró se salda trabajando para el acreedor.
          if (o.bondage && res.loan.status === "defaulted" && res.loss > 0) {
            const bid = ctx.newId("commitment");
            const bond = makeBondage({
              id: bid as string,
              creditor: l.lender,
              debtor: l.borrower,
              debt: res.loss,
              wagePerDay: o.bondage.wagePerDay,
              upkeepPerDay: o.bondage.upkeepPerDay,
              startDay: today,
              maxDays: o.bondage.maxDays,
              basis: "norm",
              parent: r.id,
              originEventId: draftEvent(events.length) as unknown as string,
            });
            if (bond) {
              events.push({
                kind: "credit.bonded",
                actors: [borrowerMan, lenderMan],
                place: o.placeOf(ctx.truth, lenderMan),
                data: { loan: r.id, commitment: bid, debt: res.loss, maxDays: o.bondage.maxDays },
                emissions: {},
                causes: [{ kind: "event" as const, event: draftEvent(k) as never }],
              });
              changes.push(
                setComponent(
                  ENTITY,
                  bid as never,
                  {
                    id: bid,
                    originEventId: draftEvent(events.length - 1),
                    createdAt: ctx.now,
                  } as never,
                ),
                setComponent(COMMITMENTS, bid as never, bond),
              );
            }
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

      // Subrogación (contracts §5): el fiador que pagó cobra al deudor original, en cuotas, por ledger.
      if (o.repaySubrogation) {
        for (const r of commitmentRows(ctx.truth)) {
          const c = r.commitment;
          const ob = c.obligations[0];
          if (
            c.kind !== "subrogation" ||
            c.status !== "active" ||
            !ob ||
            ob.duty.kind !== "deliver"
          )
            continue;
          const left = ob.duty.qty - ob.performed;
          const creditorMan = firstAlive(ob.creditor);
          const debtorMan = firstAlive(ob.debtor);
          if (left <= 0 || !creditorMan || !debtorMan) continue;
          const unit = ledgerUnit(ob.duty.unit);
          const due = Math.min(left, Math.ceil(ob.duty.qty / SUBROGATION_DAYS));
          const amount = Math.min(due, Math.floor(bal(acct(ob.debtor), unit)));
          if (amount <= 0) continue;
          const performed = ob.performed + amount;
          const done = performed >= ob.duty.qty;
          const k = events.length;
          events.push({
            kind: "credit.subrogated_paid",
            actors: [debtorMan, creditorMan],
            place: o.placeOf(ctx.truth, debtorMan),
            data: {
              commitment: r.id,
              parent: c.parent,
              unit: ob.duty.unit,
              paid: amount,
              left: ob.duty.qty - performed,
            },
            emissions: {},
            causes: [
              { kind: "event" as const, event: c.originEventId as never },
              { kind: "state" as const, entity: r.id as unknown as EntityRef, key: "subrogation" },
            ],
          });
          const ts = [{ unit, from: acct(ob.debtor), to: acct(ob.creditor), amount }];
          postings.push({ event: draftEvent(k), transfers: ts });
          apply(ts);
          changes.push(
            setComponent(COMMITMENTS, r.id as never, {
              ...c,
              obligations: [
                { ...ob, performed, state: done ? "fulfilled" : "partial" },
                ...c.obligations.slice(1),
              ],
              status: done ? "fulfilled" : "active",
              history: [...c.history, "credit.subrogated_paid"],
            }),
          );
        }
      }

      // Servidumbre: el deudor trabaja un día; termina pagada, por plazo o huyendo (abono 0 a mitad de plazo).
      if (o.bondage) {
        for (const r of commitmentRows(ctx.truth)) {
          const c = r.commitment;
          const ob = c.obligations[0];
          if (c.kind !== "bondage" || c.status !== "active" || !ob || ob.duty.kind !== "work")
            continue;
          const creditorMan = firstAlive(ob.creditor);
          const debtorMan = firstAlive(ob.debtor);
          if (!creditorMan || !debtorMan) continue;
          const cause = [
            { kind: "event" as const, event: c.originEventId as never },
            { kind: "state" as const, entity: r.id as unknown as EntityRef, key: "bondage" },
          ];
          const endWith = (
            end: "term" | "escape" | "ransom" | "abuse",
            extra: Record<string, unknown> = {},
          ) => {
            const k = events.length;
            const done = endBondage(c, end, draftEvent(k) as unknown as string);
            events.push({
              kind: "credit.bondage_ended",
              actors: [debtorMan, creditorMan],
              place: o.placeOf(ctx.truth, debtorMan),
              data: { commitment: r.id, parent: c.parent, end, unpaid: done.unpaid, ...extra },
              emissions: {},
              causes: cause,
            });
            changes.push(setComponent(COMMITMENTS, r.id as never, done.commitment));
          };
          if (bondageExpired(c, today)) {
            endWith("term");
            continue;
          }
          const half = c.term.startDay + (c.term.endDay - c.term.startDay) / 2;
          if (ob.duty.creditPerDay <= 0 && today >= half) {
            endWith("escape");
            continue;
          }
          // Rescate: un conocido del deudor con saldo paga lo que falta (conservación por el ledger).
          const owedLeft = Math.ceil(bondageDebtLeft(c));
          const unit = c.parent ? ctx.truth.get(LOANS, c.parent as never)?.unit : undefined;
          if (o.bondage?.ransom && owedLeft > 0 && unit) {
            const debtorHome = ctx.truth.get(PERSON, debtorMan)?.household;
            let best: { man: AgentId; home: string; trust: number } | undefined;
            for (const id of [...ctx.truth.ids(PERSON)].sort()) {
              const p = ctx.truth.get(PERSON, id);
              if (!p || p.household === debtorHome || p.household === ob.creditor) continue;
              if (ctx.truth.get(ENTITY, id)?.endedAt !== undefined) continue;
              const toward = ctx.truth.get(RELATIONS, id)?.toward;
              const trust = trustNow(toward?.[debtorMan as string], ctx.now, o.relationDecay);
              if (trust <= 0 || bal(acct(p.household), unit) < owedLeft) continue;
              if (!best || trust > best.trust)
                best = { man: id as AgentId, home: p.household, trust };
            }
            if (best) {
              const k = events.length;
              const ts = [{ unit, from: acct(best.home), to: acct(ob.creditor), amount: owedLeft }];
              postings.push({ event: draftEvent(k), transfers: ts });
              apply(ts);
              endWith("ransom", { ransomer: best.man, paid: owedLeft });
              continue;
            }
          }
          // Abuso: el acreedor rompe el trato; los vecinos que confiaban en él le quitan confianza.
          const ab = o.bondage?.abuse;
          if (
            ab &&
            ctx.rng.fork("bondageAbuse", r.id, today).chance(ab.chance(ctx.truth, creditorMan))
          ) {
            endWith("abuse", { reputationCost: ab.reputationCost });
            for (const id of [...ctx.truth.ids(PERSON)].sort()) {
              if (id === (creditorMan as unknown) || id === (debtorMan as unknown)) continue;
              const rel = ctx.truth.get(RELATIONS, id);
              const old = rel?.toward[creditorMan as string];
              if (!rel || !old || (old.dims.trust ?? 0) <= 0) continue;
              const trust = Math.max(0, (old.dims.trust ?? 0) - ab.reputationCost);
              changes.push(
                setComponent(RELATIONS, id as never, {
                  ...rel,
                  toward: {
                    ...rel.toward,
                    [creditorMan as string]: { ...old, dims: { ...old.dims, trust } },
                  },
                }),
              );
            }
            continue;
          }
          const w = workBondageDay(c, today);
          if (w.credited <= 0) continue;
          const k = events.length;
          events.push({
            kind: "credit.bondage_worked",
            actors: [debtorMan, creditorMan],
            place: o.placeOf(ctx.truth, debtorMan),
            data: { commitment: r.id, parent: c.parent, credited: w.credited, paid: w.paid },
            emissions: {},
            causes: cause,
          });
          changes.push(
            setComponent(COMMITMENTS, r.id as never, {
              ...w.commitment,
              history: [...w.commitment.history, draftEvent(k) as unknown as string],
            }),
          );
        }
      }

      if (events.length === 0) return {};
      return { events, postings, changes };
    },
  };
}
