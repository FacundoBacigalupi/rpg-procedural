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
  type Event,
  type EventId,
  type HolderRef,
  holderAccount,
  type Ledger,
  type LedgerAccount,
  type LedgerUnit,
  ledgerUnit,
  type PlaceRef,
  type PlanetClock,
  type Transfer,
} from "../../core/index.ts";
import {
  kindInterestDue,
  kindInterestOutstanding,
  payLoanInKind,
  principalOutstanding,
  withKindInterest,
} from "../../sim/economy/creditKind.ts";
import {
  bondageDebtLeft,
  bondageExpired,
  type Collateral,
  type Commitment,
  chooseDisguise,
  current,
  type DecayContext,
  type DisguisedTerms,
  type DisguiseKind,
  disguiseInterest,
  draftEvent,
  ENTITY,
  type EnforcementContext,
  type EventDraft,
  effectiveRate,
  endBondage,
  estimateDisguise,
  executeDefault,
  FACE,
  type GoodDef,
  type Guarantor,
  goodUnit,
  guarantorSubrogation,
  installmentPerDay,
  interestOf,
  type LoanCommitment,
  loanToCommitment,
  makeBondage,
  makeLoan,
  outstanding,
  PARCEL,
  type Parcel,
  PERSON,
  PERSON_CULTURE,
  type PostingDraft,
  type ProcessDef,
  payLoan,
  RELATIONS,
  type ReadonlyWorldTruth,
  type Relationship,
  ruleUsuryCase,
  type StateChange,
  setComponent,
  TRADE_RECEIPTS,
  table,
  WORK_DAY_UNIT,
  workBondageDay,
} from "../../sim/index.ts";
import { ECONOMIC_SERIAL_DOMAIN, ECONOMIC_SERIAL_GROUP } from "./economic-batch.ts";
import {
  FUNERALS,
  type FuneralOptions,
  resolveFunerals,
  validateFuneralOptions,
} from "./funerals.ts";

export const LOANS_PROCESS = "life.loans";

/** Términos que las partes conocen cuando el fiador paga, dentro de credit.defaulted. */
export interface SubrogationNotice {
  readonly commitment: string;
  readonly debtor: AgentId;
  readonly creditor: AgentId;
  readonly debtorRef: string;
  readonly creditorRef: string;
  readonly unit: string;
  readonly qty: number;
  readonly dueDay: number;
}

/** El préstamo guardado: el compromiso económico y la semilla de la que nació. */
export type LoanRow = LoanCommitment & {
  readonly seed: string;
  /** Con `LoansOptions.usury`: los términos disfrazados con que se pactó (la tasa de la fila es la efectiva real). */
  readonly disguise?: DisguisedTerms;
  /**
   * Con `UsuryOptions.communityCase`: quienes sospecharon al abrirse (la evidencia del caso) y el día
   * en que la comunidad lo resolvió (`ruledOn`); sin `ruledOn` el caso sigue abierto.
   */
  readonly usuryCase?: {
    readonly witnesses: readonly { readonly observer: AgentId; readonly impliedRate: number }[];
    readonly ruledOn?: number;
  };
};
/** Cada préstamo vive en una entidad `commitment:n` con este componente. */
export const LOANS = table<LoanRow>("economy.loans");
/**
 * La vista contractual de cada préstamo (contracts §1) y las subrogaciones de los fiadores que
 * pagaron (§5), con la misma clave `commitment:N`. Solo la escribe el proceso de préstamos.
 */
export const COMMITMENTS = table<Commitment>("contracts.commitment");

/** Si el hogar (anotado en su primer vivo) estaba caído la última vez que se calculó el contagio. Solo escribe `life.contagion`. */
export const CONTAGION_STATE = table<{ readonly failed: boolean }>("life.contagion_state");

/** Con interés en especie el `Commitment` y la mora cuentan solo el principal (el interés va en otra unidad). */
function principalView<T extends LoanCommitment>(l: T): T {
  if (!l.inKind) return l;
  const { periods: _p, ...rest } = l;
  return { ...rest, rate: 0 } as T;
}

/** Un préstamo decidido de antemano: la única fuente de préstamos hasta que los hogares apretados los pidan. */
export interface LoanSeed {
  readonly id: string;
  /** Hogar prestamista y hogar deudor. */
  readonly lender: string;
  readonly borrower: string;
  /** Bien del principal (`grain`, una moneda…). */
  readonly good: string;
  readonly principal: number;
  /** Interés simple por plazo; con `periods` > 1, la tasa de cada período. */
  readonly rate: number;
  /**
   * Opt-in: períodos de capitalización que elige el prestamista (el usurero que capitaliza por mes).
   * Ausente o 1: interés simple, sin campo nuevo en la fila. Se ignora si el interés va disfrazado
   * (ahí la tasa de la fila ya es la efectiva real).
   */
  readonly periods?: number;
  /**
   * Opt-in: el interés se paga en otro bien (`good`) a razón `ratio` (`creditKind.ts`): el principal
   * vuelve en su unidad y el interés, `ceil(interés * ratio)`, en grano. Se ignora si el interés va
   * disfrazado. Ausente: nada cambia, ni la fila ni el evento.
   */
  readonly inKind?: { readonly good: string; readonly ratio: number };
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
  readonly funerals?: FuneralOptions;
  readonly eventOf?: (id: EventId) => Event | undefined;
  /** Opt-in: reserva común de saldos con las acciones económicas de la misma fase. */
  readonly economicBatch?: boolean;
  /** Opt-in: anuncia a las partes los derechos creados cuando paga un fiador. */
  readonly debtKnowledge?: boolean;
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
  /**
   * Opt-in (con `life.contagion`): el prestamista arrastrado por una quiebra ajena (caído, o con un
   * deudor activo caído) cobra `rateMarkup` más de tasa en lo que abre mientras dure; el caído no presta.
   */
  readonly contagionCaution?: { readonly rateMarkup: number };
  /** Opt-in: la confianza de RELATIONS se lee con `current` (decaimiento al día de hoy); sin esto, tal cual está guardada. */
  readonly relationDecay?: DecayContext;
  /** Opt-in: donde la cultura prohíbe el interés, el prestamista lo disfraza y la deuda registra la tasa efectiva real. */
  readonly usury?: UsuryOptions;
  /**
   * Opt-in: norma de usura sobre la tasa efectiva compuesta (interés total / principal): el
   * prestamista no abre lo que la supere (la capitalización no la esquiva).
   */
  readonly maxEffectiveRate?: number;
}

/** Prohibición de usura (economy §8): donde se prohíbe el interés, el prestamista lo disfraza. */
export interface UsuryOptions {
  /** Si la cultura del hogar prestamista prohíbe cobrar interés (calculada afuera, de sus normas). */
  readonly prohibits: (truth: ReadonlyWorldTruth, lenderHome: string) => boolean;
  /** Disfraces que tiene a mano ese prestamista; sin ninguno no presta con interés. */
  readonly available:
    | readonly DisguiseKind[]
    | ((
        truth: ReadonlyWorldTruth,
        lenderHome: string,
        ledger?: Pick<Ledger, "balance" | "holdings">,
      ) => readonly DisguiseKind[]);
  /** Cuánto llama la atención cada disfraz en esa cultura (0-1). */
  readonly visibility?: Partial<Record<DisguiseKind, number>>;
  /** Jornal de mercado (valor por día) para el disfraz de trabajo. */
  readonly wagePerDay?: number;
  /**
   * Opt-in: terceros (otros hogares) que tasan el trato; `believedValue` es lo que ese observador cree
   * que valió lo recibido (error de tasación incluido). Si sospecha, nace `credit.usury_suspected`.
   */
  readonly communityCase?: {
    /** Testigos creíbles mínimos (por defecto 1). */
    readonly quorum?: number;
    /** Días entre abrirse el trato y resolverse el caso (por defecto 1). */
    readonly delayDays?: number;
    /** Multa sobre el exceso de interés, a favor del deudor (por defecto 0). */
    readonly fineFactor?: number;
  };
  readonly suspicion?: {
    readonly tolerance?: number;
    readonly believedValue: (
      truth: ReadonlyWorldTruth,
      observer: AgentId,
      principal: number,
    ) => number;
  };
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
   * Opt-in: el día de servidumbre solo abona si el hogar del deudor no cobró un jornal ese día
   * (`TRADE_RECEIPTS` con `day === today`): quien ya trabajó por salario no trabaja dos veces.
   */
  readonly onlyWithoutOtherWage?: boolean;
  /**
   * Opt-in: el jornal de la servidumbre sale del oficio que sabe el deudor (la habilidad, calculada
   * afuera) en vez de `wagePerDay`; se fija al abrirse. Si devuelve `undefined` o <= 0, vale la constante.
   */
  readonly skillWage?: (truth: ReadonlyWorldTruth, debtor: AgentId) => number | undefined;
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
  if (o.funerals) validateFuneralOptions(o.funerals, o.goods);
  const goodDef = new Map(o.goods.map((g) => [g.id, g]));
  const enf = o.enforcement ? { enforcement: o.enforcement } : {};
  return {
    id: LOANS_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "act",
    ...(o.economicBatch
      ? { serialDomain: ECONOMIC_SERIAL_DOMAIN, serialGroup: () => ECONOMIC_SERIAL_GROUP }
      : {}),
    reads: [
      PERSON.name,
      ENTITY.name,
      LOANS.name,
      COMMITMENTS.name,
      PARCEL.name,
      RELATIONS.name,
      ...(o.contagionCaution ? [CONTAGION_STATE.name] : []),
      ...(o.bondage?.onlyWithoutOtherWage ? [TRADE_RECEIPTS.name] : []),
      ...(o.funerals ? [FUNERALS.name, FACE.name, PERSON_CULTURE.name] : []),
    ],
    writes: [
      LOANS.name,
      COMMITMENTS.name,
      ENTITY.name,
      PARCEL.name,
      ...(o.bondage?.abuse ? [RELATIONS.name] : []),
      ...(o.funerals ? [FUNERALS.name, FACE.name] : []),
    ],
    run(ctx) {
      const ledger = ctx.ledger;
      if (!ledger || (o.seeds.length === 0 && !o.funerals)) return {};
      const today = Math.floor(ctx.now / o.clock.day);

      const firstAlive = (home: string): AgentId | undefined => {
        for (const id of [...ctx.truth.ids(PERSON)].sort()) {
          if (ctx.truth.get(PERSON, id)?.household !== home) continue;
          if (ctx.truth.get(ENTITY, id)?.endedAt === undefined) return id as AgentId;
        }
        return undefined;
      };
      const delta = new Map<string, number>();
      const changedUnits = new Map<LedgerAccount, Set<LedgerUnit>>();
      const key = (a: LedgerAccount, u: string) => `${a}|${u}`;
      const bal = (a: LedgerAccount, u: string) =>
        (ledger.balance(a, u as never) ?? 0) + (delta.get(key(a, u)) ?? 0);
      const apply = (ts: readonly Transfer[]) => {
        for (const t of ts) {
          delta.set(key(t.from, t.unit), (delta.get(key(t.from, t.unit)) ?? 0) - t.amount);
          delta.set(key(t.to, t.unit), (delta.get(key(t.to, t.unit)) ?? 0) + t.amount);
          if (o.economicBatch)
            for (const account of [t.from, t.to]) {
              const units = changedUnits.get(account) ?? new Set<LedgerUnit>();
              units.add(t.unit);
              changedUnits.set(account, units);
            }
        }
      };
      // Incluye miembros anteriores del dominio y asientos anteriores del mismo resultado.
      // Solo enumera unidades de la cuenta consultada: no copia verdad, saldos globales ni journal.
      const usuryLedger: Pick<Ledger, "balance" | "holdings"> = {
        balance: bal,
        holdings(account) {
          const units = new Set([
            ...ledger.holdings(account).map((row) => row.unit),
            ...(changedUnits.get(account) ?? []),
          ]);
          return [...units]
            .map((unit) => ({ unit, amount: bal(account, unit) }))
            .filter((row) => row.amount > 0)
            .sort((a, b) => (a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : 0));
        },
      };

      const events: EventDraft[] = [];
      const postings: PostingDraft[] = [];
      const changes: StateChange[] = [];
      const rows = loanRows(ctx.truth);
      const known = new Set(rows.map((r) => r.loan.seed));

      const failedHome = (home: string): boolean => {
        const m = firstAlive(home);
        return m !== undefined && ctx.truth.get(CONTAGION_STATE, m)?.failed === true;
      };
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
        let rate = s.rate;
        if (o.contagionCaution) {
          if (failedHome(s.lender)) continue;
          if (
            rows.some(
              (r) =>
                r.loan.status === "active" &&
                r.loan.lender === s.lender &&
                failedHome(r.loan.borrower),
            )
          )
            rate += o.contagionCaution.rateMarkup;
        }
        let disguise: DisguisedTerms | undefined;
        if (o.usury && rate > 0 && o.usury.prohibits(ctx.truth, s.lender)) {
          const kind = chooseDisguise(
            typeof o.usury.available === "function"
              ? o.economicBatch
                ? o.usury.available(ctx.truth, s.lender, usuryLedger)
                : o.usury.available(ctx.truth, s.lender)
              : o.usury.available,
            o.usury.visibility,
          );
          if (!kind) continue;
          disguise = disguiseInterest({
            principal: s.principal,
            rate,
            termDays: s.termDays,
            kind,
            ...(o.usury.wagePerDay !== undefined ? { wagePerDay: o.usury.wagePerDay } : {}),
          });
          rate = effectiveRate(disguise);
        }
        const periods = !disguise && (s.periods ?? 1) > 1 ? s.periods : undefined;
        if (
          o.maxEffectiveRate !== undefined &&
          interestOf({
            principal: s.principal,
            rate,
            ...(periods !== undefined ? { periods } : {}),
          }) /
            s.principal >
            o.maxEffectiveRate
        )
          continue;
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
          rate,
          ...(periods !== undefined ? { periods } : {}),
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
        const kindDef = s.inKind && !disguise ? goodDef.get(s.inKind.good) : undefined;
        const kinded =
          s.inKind && kindDef ? withKindInterest(loan, goodUnit(kindDef), s.inKind.ratio) : loan;
        let row: LoanRow = { ...kinded, seed: s.id, ...(disguise ? { disguise } : {}) };
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
            ...(row.periods !== undefined ? { periods: row.periods } : {}),
            dueDay: row.dueDay,
            ...(disguise ? { disguise: disguise.kind, statedRate: disguise.statedRate } : {}),
            ...(row.inKind
              ? {
                  inKind: {
                    unit: row.inKind.unit,
                    ratio: row.inKind.ratio,
                    interest: kindInterestDue(row),
                  },
                }
              : {}),
          },
          emissions: {},
          causes: [
            { kind: "state", entity: s.lender as unknown as EntityRef, key: `loan-seed:${s.id}` },
          ],
        });
        const witnesses: { observer: AgentId; impliedRate: number }[] = [];
        if (disguise && o.usury?.suspicion) {
          const sus = o.usury.suspicion;
          for (const oid of [...ctx.truth.ids(PERSON)].sort()) {
            const p = ctx.truth.get(PERSON, oid);
            if (!p || p.household === s.lender || p.household === s.borrower) continue;
            if (ctx.truth.get(ENTITY, oid)?.endedAt !== undefined) continue;
            const est = estimateDisguise(
              {
                kind: disguise.kind,
                believedReceivedValue: sus.believedValue(ctx.truth, oid as AgentId, s.principal),
                moneyDue: disguise.moneyDue,
                giftValue: disguise.giftValue,
                laborDays: disguise.laborDays,
                believedWagePerDay: disguise.wagePerDay,
                termDays: disguise.termDays,
              },
              sus.tolerance,
            );
            if (!est.suspected) continue;
            witnesses.push({ observer: oid as AgentId, impliedRate: est.impliedRate });
            events.push({
              kind: "credit.usury_suspected",
              actors: [oid as AgentId, lenderMan],
              place: o.placeOf(ctx.truth, lenderMan),
              data: { loan: id, impliedRate: est.impliedRate, excess: est.excess },
              emissions: {},
              causes: [{ kind: "event" as const, event: draftEvent(k) as never }],
            });
          }
        }
        if (witnesses.length > 0 && o.usury?.communityCase && o.enforcement?.community)
          row = { ...row, usuryCase: { witnesses } };
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
          setComponent(COMMITMENTS, id as never, loanToCommitment(principalView(row), enf)),
        );
        opened.push({ id: id as string, loan: row });
      }

      // Cobrar o ejecutar: los activos de antes (los recién abiertos empiezan mañana).
      for (const r of rows) {
        let l = r.loan;
        if (l.status !== "active") continue;
        // Los funerales obligan bolsas personales. La sucesión aún no reasigna esa obligación:
        // otro familiar vivo no habilita cobrar la bolsa de un titular muerto o inexistente.
        if (l.seed.startsWith("funeral:")) {
          const debtor = ctx.truth.get(ENTITY, l.borrowerAccount as unknown as EntityRef);
          const creditor = ctx.truth.get(ENTITY, l.lenderAccount as unknown as EntityRef);
          if (
            !debtor ||
            !creditor ||
            debtor.endedAt !== undefined ||
            creditor.endedAt !== undefined
          )
            continue;
        }
        const lenderMan = firstAlive(l.lender);
        const borrowerMan = firstAlive(l.borrower);
        if (!lenderMan || !borrowerMan) continue;
        const cause = [
          { kind: "event" as const, event: l.originEventId as never },
          { kind: "state" as const, entity: r.id as unknown as EntityRef, key: "loan" },
        ];
        // Caso comunitario por usura: la evidencia son los testigos que tasaron el trato; los que
        // todavía viven y le creen al deudor al menos como al prestamista cuentan como creídos.
        const cc = o.usury?.communityCase;
        if (
          cc &&
          l.usuryCase &&
          l.usuryCase.ruledOn === undefined &&
          today >= l.startDay + (cc.delayDays ?? 1)
        ) {
          const ws = l.usuryCase.witnesses
            .filter((w) => ctx.truth.get(ENTITY, w.observer)?.endedAt === undefined)
            .map((w) => {
              const toward = ctx.truth.get(RELATIONS, w.observer)?.toward;
              const tB = trustNow(toward?.[borrowerMan as string], ctx.now, o.relationDecay);
              const tL = trustNow(toward?.[lenderMan as string], ctx.now, o.relationDecay);
              return {
                observer: w.observer,
                impliedRate: w.impliedRate,
                credibility: Math.max(0, Math.min(1, 0.5 + (tB - tL) / 2)),
              };
            });
          const ruling = ruleUsuryCase({
            witnesses: ws,
            ...(cc.quorum !== undefined ? { quorum: cc.quorum } : {}),
            ...(cc.fineFactor !== undefined ? { fineFactor: cc.fineFactor } : {}),
            lawfulRate: l.disguise?.statedRate ?? 0,
            principal: l.principal,
            appliedRate: l.rate,
            paid: l.paid,
          });
          const ck = events.length;
          events.push({
            kind: "credit.usury_ruled",
            actors: [borrowerMan, lenderMan],
            place: o.placeOf(ctx.truth, lenderMan),
            data: {
              loan: r.id,
              community: o.enforcement?.community,
              upheld: ruling.upheld,
              evidence: ws.map((w) => ({ observer: w.observer, impliedRate: w.impliedRate })),
              believedRate: ruling.believedRate,
              refund: 0,
              fine: 0,
              newRate: ruling.newRate,
            },
            emissions: {},
            causes: cause,
          });
          let paidNow = l.paid;
          if (ruling.upheld) {
            const owe = Math.min(
              ruling.refund + ruling.fine,
              Math.floor(bal(l.lenderAccount, l.unit)),
            );
            const refund = Math.min(ruling.refund, owe);
            const fine = owe - refund;
            const ts: Transfer[] =
              owe > 0
                ? [{ unit: l.unit, from: l.lenderAccount, to: l.borrowerAccount, amount: owe }]
                : [];
            if (ts.length > 0) {
              postings.push({ event: draftEvent(ck), transfers: ts });
              apply(ts);
            }
            paidNow = l.paid - refund;
            const ev = events[ck];
            if (ev) events[ck] = { ...ev, data: { ...(ev.data as object), refund, fine } };
          }
          let adj: LoanRow = {
            ...l,
            rate: ruling.newRate,
            paid: paidNow,
            usuryCase: { ...l.usuryCase, ruledOn: today },
          };
          if (outstanding(adj) === 0) adj = { ...adj, status: "repaid" };
          l = adj;
          changes.push(
            setComponent(LOANS, r.id as never, adj),
            setComponent(COMMITMENTS, r.id as never, loanToCommitment(adj, enf)),
          );
          if (l.status !== "active") continue;
        }
        if (today >= l.dueDay) {
          const holds = new Map(l.guarantors.map((g) => [g.id, bal(g.account, l.unit)]));
          const res0 = executeDefault(principalView(l), today, holds);
          let res = res0;
          let kindSeized = 0;
          let kindLoss = 0;
          if (l.inKind) {
            const kindOwed = kindInterestOutstanding(l);
            kindSeized = Math.max(
              0,
              Math.min(kindOwed, Math.floor(bal(l.borrowerAccount, l.inKind.unit))),
            );
            kindLoss = kindOwed - kindSeized;
            res = {
              ...res0,
              transfers:
                kindSeized > 0
                  ? [
                      ...res0.transfers,
                      {
                        unit: l.inKind.unit,
                        from: l.borrowerAccount,
                        to: l.lenderAccount,
                        amount: kindSeized,
                      },
                    ]
                  : res0.transfers,
              loan: {
                ...l,
                paid: res0.loan.paid,
                inKind: { ...l.inKind, paidKind: l.inKind.paidKind + kindSeized },
                status: res0.loan.status === "defaulted" || kindLoss > 0 ? "defaulted" : "settled",
              },
            };
          }
          const k = events.length;
          events.push({
            kind: "credit.defaulted",
            actors: [borrowerMan, lenderMan],
            place: o.placeOf(ctx.truth, lenderMan),
            data: {
              loan: r.id,
              owed: l.inKind ? principalOutstanding(l) : outstanding(l),
              loss: res.loss,
              ...(l.inKind ? { kindSeized, kindLoss } : {}),
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
          const parent = loanToCommitment(principalView(next), enf);
          changes.push(
            setComponent(LOANS, r.id as never, next),
            setComponent(COMMITMENTS, r.id as never, {
              ...parent,
              history: [...parent.history, "credit.defaulted"],
            }),
          );
          // El fiador que pagó queda como acreedor del deudor (subrogación, contracts §5).
          const subrogations: SubrogationNotice[] = [];
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
            if (o.debtKnowledge) {
              const creditor = firstAlive(gp.id);
              if (creditor)
                subrogations.push({
                  commitment: sid as string,
                  creditor,
                  debtor: borrowerMan,
                  creditorRef: gp.id,
                  debtorRef: l.borrower,
                  unit: l.unit,
                  qty: gp.amount,
                  dueDay: today,
                });
            }
            changes.push(
              setComponent(
                ENTITY,
                sid as never,
                { id: sid, originEventId: draftEvent(k), createdAt: ctx.now } as never,
              ),
              setComponent(COMMITMENTS, sid as never, sub),
            );
          }
          if (subrogations.length > 0) {
            const source = events[k];
            if (source)
              events[k] = { ...source, data: { ...(source.data as object), subrogations } };
          }
          // Servidumbre (contracts §2): lo que no se cobró se salda trabajando para el acreedor.
          if (o.bondage && res.loan.status === "defaulted" && res.loss > 0) {
            const bid = ctx.newId("commitment");
            const sw = o.bondage.skillWage?.(ctx.truth, borrowerMan);
            const skillWageOf = sw !== undefined && sw > 0 ? sw : undefined;
            const bond = makeBondage({
              id: bid as string,
              creditor: l.lender,
              debtor: l.borrower,
              debt: res.loss,
              wagePerDay: skillWageOf ?? o.bondage.wagePerDay,
              upkeepPerDay: o.bondage.upkeepPerDay,
              startDay: today,
              maxDays: o.bondage.maxDays,
              basis: "norm",
              parent: r.id,
              originEventId: draftEvent(events.length) as unknown as string,
            });
            if (bond) {
              const work = bond.obligations[0]?.duty;
              events.push({
                kind: "credit.bonded",
                actors: [borrowerMan, lenderMan],
                place: o.placeOf(ctx.truth, lenderMan),
                data: {
                  loan: r.id,
                  commitment: bid,
                  debt: res.loss,
                  maxDays: o.bondage.maxDays,
                  ...(o.debtKnowledge && work?.kind === "work"
                    ? {
                        unit: WORK_DAY_UNIT,
                        workDays: work.qty,
                        creditPerDay: work.creditPerDay,
                        debtUnit: l.unit,
                      }
                    : {}),
                },
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
        if (l.inKind) {
          const days = Math.max(1, l.dueDay - today);
          const kp = payLoanInKind(
            l,
            Math.ceil(principalOutstanding(l) / days),
            Math.ceil(kindInterestOutstanding(l) / days),
            bal(l.borrowerAccount, l.unit),
            bal(l.borrowerAccount, l.inKind.unit),
          );
          if (kp.paidPrincipal <= 0 && kp.paidInterest <= 0) continue;
          const kk = events.length;
          events.push({
            kind: "credit.paid",
            actors: [borrowerMan, lenderMan],
            place: o.placeOf(ctx.truth, borrowerMan),
            data: {
              loan: r.id,
              paid: kp.paidPrincipal,
              paidInterest: kp.paidInterest,
              status: kp.loan.status,
            },
            emissions: {},
            causes: cause,
          });
          postings.push({ event: draftEvent(kk), transfers: kp.transfers });
          apply(kp.transfers);
          const kRow: LoanRow = { ...kp.loan, seed: l.seed };
          changes.push(
            setComponent(LOANS, r.id as never, kRow),
            setComponent(COMMITMENTS, r.id as never, loanToCommitment(principalView(kRow), enf)),
          );
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
          if (o.bondage.onlyWithoutOtherWage) {
            const home = ctx.truth.get(PERSON, debtorMan)?.household;
            const paidToday = home
              ? (ctx.truth.get(TRADE_RECEIPTS, home as never)?.receipts ?? []).some(
                  (x) => x.day === today && x.coins > 0,
                )
              : false;
            if (paidToday) continue;
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

      if (o.funerals && o.eventOf)
        resolveFunerals(
          ctx,
          o.funerals,
          o.goods,
          today,
          bal,
          apply,
          events,
          postings,
          changes,
          o.eventOf,
          (who) => o.placeOf(ctx.truth, who),
          (base, dead) => {
            const loan: LoanRow = { ...base, seed: `funeral:${dead}` };
            changes.push(
              setComponent(ENTITY, loan.id, {
                id: loan.id,
                originEventId: loan.originEventId,
                createdAt: ctx.now,
              } as never),
              setComponent(LOANS, loan.id, loan),
              setComponent(COMMITMENTS, loan.id, loanToCommitment(loan, enf)),
            );
          },
        );
      if (events.length === 0) return {};
      return { events, postings, changes };
    },
  };
}
