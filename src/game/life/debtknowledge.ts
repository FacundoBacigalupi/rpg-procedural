// Libro contractual personal (contracts §4, information §1): participación directa, nunca
// lectura del saldo actual. Un pago remoto o un préstamo secreto no se aprende por existir.
import {
  type AgentId,
  compareStrings,
  type Event,
  type EventId,
  type Tick,
} from "../../core/index.ts";
import {
  BODY_STATE,
  CREDIT,
  ENTITY,
  type MediumInput,
  PERSON,
  type ProcessDef,
  setComponent,
  table,
} from "../../sim/index.ts";
import { paidIn } from "./credit.ts";
import { COMMITMENTS, type SubrogationNotice } from "./loans.ts";

export interface DebtBelief {
  readonly commitment: string;
  readonly kind?: "loan" | "subrogation" | "credit";
  /** Momento del acuerdo: mantiene el orden de devolución al actualizar learnedAt. */
  readonly openedAt?: Tick;
  readonly parent?: string;
  readonly role: "debtor" | "creditor";
  readonly other: AgentId;
  /** Referencias del acuerdo; no convierten a todo el hogar en observador. */
  readonly debtorRef: string;
  readonly creditorRef: string;
  readonly unit: string;
  readonly total: number;
  readonly remaining: number;
  /** Ausente cuando el acto no anunció plazo y no consta una norma conocida. */
  readonly dueDay?: number;
  readonly status: "active" | "fulfilled" | "defaulted" | "settled";
  readonly originEventId: EventId;
  readonly learnedAt: Tick;
  /** 0-1: certeza de lo conocido; participación propia nace en 1. */
  readonly confidence: number;
  /** Fuentes propias: además impiden descontar dos veces el mismo pago. */
  readonly sources: readonly EventId[];
}

export interface DebtBook {
  readonly items: readonly DebtBelief[];
}
export const DEBT_BOOK = table<DebtBook>("life.debt_book");
export const DEBT_KNOWLEDGE_PROCESS = "life.debt_knowledge";

export type DebtObservation =
  | { readonly kind: "opened"; readonly belief: DebtBelief }
  | {
      readonly kind: "paid";
      readonly commitment: string;
      readonly amount: number;
      readonly event: EventId;
      readonly at: Tick;
      readonly fulfilled: boolean;
      /** Saldo expresamente conocido en la devolución al fiador, no consultado en la verdad. */
      readonly knownRemaining?: number;
    }
  | {
      readonly kind: "resolved";
      readonly commitment: string;
      readonly remaining: number;
      readonly status: "defaulted" | "settled";
      readonly event: EventId;
      readonly at: Tick;
    };

/** Núcleo puro: solo lo que una parte recibió, con fuentes y cantidades conocidas. */
export function observeDebt(book: DebtBook | undefined, observation: DebtObservation): DebtBook {
  const items = book?.items ?? [];
  if (observation.kind === "opened") {
    if (items.some((b) => b.commitment === observation.belief.commitment)) return book as DebtBook;
    return {
      items: [...items, observation.belief].sort((a, b) =>
        a.commitment < b.commitment ? -1 : a.commitment > b.commitment ? 1 : 0,
      ),
    };
  }
  return {
    items: items.map((b) => {
      if (
        b.commitment !== observation.commitment ||
        b.sources.includes(observation.event) ||
        observation.at < b.learnedAt
      )
        return b;
      const remaining =
        observation.kind === "paid"
          ? observation.fulfilled
            ? 0
            : Math.max(0, observation.knownRemaining ?? b.remaining - observation.amount)
          : Math.max(0, observation.remaining);
      const status =
        observation.kind === "resolved"
          ? observation.status
          : remaining === 0
            ? "fulfilled"
            : b.status;
      return {
        ...b,
        remaining,
        status,
        learnedAt: observation.at,
        sources: [...b.sources, observation.event],
      };
    }),
  };
}

/** Sin sumar magnitudes de unidades distintas: proporción pendiente de cada contrato conocido. */
export function believedDebtRatio(belief: DebtBelief): number {
  if (
    belief.role !== "debtor" ||
    belief.status === "fulfilled" ||
    belief.status === "settled" ||
    belief.total <= 0
  )
    return 0;
  return Math.round(Math.min(1, Math.max(0, belief.remaining / belief.total)) * 1e6) / 1e6;
}

/** Una meta por contraparte conocida; la mayor fracción pendiente, sin sumar monedas con grano. */
export function debtGoalInputs(book: DebtBook | undefined): MediumInput[] {
  const byOther = new Map<AgentId, { readonly belief: DebtBelief; readonly debt: number }>();
  for (const belief of [...(book?.items ?? [])].sort((a, b) =>
    compareStrings(a.commitment, b.commitment),
  )) {
    const debt =
      Math.round(
        believedDebtRatio(belief) * Math.min(1, Math.max(0, belief.confidence ?? 1)) * 1e6,
      ) / 1e6;
    if (debt <= 0) continue;
    const prev = byOther.get(belief.other);
    if (prev === undefined || debt > prev.debt) byOther.set(belief.other, { belief, debt });
  }
  return [...byOther]
    .sort(([a], [b]) => compareStrings(a, b))
    .map(([who, { belief, debt }]) => ({
      who,
      debt,
      debtOriginEventId: belief.originEventId,
      resentment: 0,
      closeness: 0,
      kin: false,
    }));
}

function numberIn(e: Event, key: string): number | undefined {
  const v = recordOf(e.data)?.[key];
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** FIFO de fiados conocidos, sin completar huecos con deudas verdaderas que nadie le contó. */
export function observeCreditPayment(
  book: DebtBook | undefined,
  holder: AgentId,
  payer: AgentId,
  to: AgentId,
  unit: string,
  amount: number,
  event: EventId,
  at: Tick,
  credit?: string,
): DebtBook {
  let next = book ?? { items: [] };
  const eligible = next.items.filter(
    (b) =>
      b.kind === "credit" &&
      b.unit === unit &&
      (credit === undefined || b.commitment === credit) &&
      ((holder === payer && b.role === "debtor" && b.other === to) ||
        (holder === to && b.role === "creditor" && b.other === payer)),
  );
  if (eligible.some((b) => b.sources.includes(event)) || !Number.isFinite(amount) || amount <= 0)
    return next;
  let left = amount;
  for (const b of [...eligible].sort(
    (a, b) =>
      (a.openedAt ?? a.learnedAt) - (b.openedAt ?? b.learnedAt) ||
      compareStrings(a.commitment, b.commitment),
  )) {
    if (left <= 0) break;
    if (b.remaining <= 0 || b.status === "settled" || b.status === "fulfilled" || at < b.learnedAt)
      continue;
    const applied = Math.min(left, b.remaining);
    next = observeDebt(next, {
      kind: "paid",
      commitment: b.commitment,
      amount: applied,
      event,
      at,
      fulfilled: applied === b.remaining,
    });
    left -= applied;
  }
  return next;
}

function subrogationsIn(e: Event): readonly SubrogationNotice[] {
  const raw = recordOf(e.data)?.["subrogations"];
  if (!Array.isArray(raw)) return [];
  return raw.filter((value): value is SubrogationNotice => {
    if (typeof value !== "object" || value === null) return false;
    const n = value as Partial<SubrogationNotice>;
    return (
      typeof n.commitment === "string" &&
      typeof n.debtor === "string" &&
      typeof n.creditor === "string" &&
      typeof n.debtorRef === "string" &&
      typeof n.creditorRef === "string" &&
      typeof n.unit === "string" &&
      typeof n.qty === "number" &&
      Number.isFinite(n.qty) &&
      n.qty > 0 &&
      typeof n.dueDay === "number" &&
      Number.isFinite(n.dueDay) &&
      n.dueDay >= 0
    );
  });
}

/** Solo participantes conscientes: recent es evidencia de su acto, no difusión a terceros. */
export function debtKnowledgeProcess(): ProcessDef {
  return {
    id: DEBT_KNOWLEDGE_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "onEvent", scene: "onEvent" },
    representation: "individual",
    phase: "perceive",
    reads: [
      DEBT_BOOK.name,
      COMMITMENTS.name,
      CREDIT.name,
      PERSON.name,
      ENTITY.name,
      BODY_STATE.name,
    ],
    writes: [DEBT_BOOK.name],
    run(ctx) {
      const books = new Map<AgentId, DebtBook>();
      const aware = (who: AgentId) =>
        ctx.truth.has(PERSON, who) &&
        ctx.truth.has(ENTITY, who) &&
        ctx.truth.has(BODY_STATE, who) &&
        ctx.truth.get(ENTITY, who)?.endedAt === undefined &&
        ctx.truth.get(BODY_STATE, who)?.consciousness !== "unconscious" &&
        ctx.truth.get(BODY_STATE, who)?.activity !== "sleep";
      const note = (who: AgentId, observation: DebtObservation) => {
        if (!aware(who)) return;
        const prev = books.get(who) ?? ctx.truth.get(DEBT_BOOK, who);
        const next = observeDebt(prev, observation);
        if (next.items.some((b, i) => b !== prev?.items[i])) books.set(who, next);
      };
      for (const e of ctx.recent) {
        const data = recordOf(e.data);
        if (!data) continue;
        const offered = recordOf(data["credit"]);
        if ((e.kind === "action.speak" || e.kind === "household.borrowed") && offered) {
          const [creditor, debtor] = e.actors as readonly AgentId[];
          const unit = offered["unit"];
          const grams = offered["grams"];
          const dueDay = offered["dueDay"];
          if (
            !creditor ||
            !debtor ||
            typeof unit !== "string" ||
            typeof grams !== "number" ||
            !Number.isFinite(grams) ||
            grams <= 0
          )
            continue;
          const id = ctx.truth
            .ids(CREDIT)
            .find(
              (id) =>
                ctx.truth.get(ENTITY, id)?.originEventId === e.id &&
                ctx.truth.get(CREDIT, id)?.creditor === creditor &&
                ctx.truth.get(CREDIT, id)?.debtor === debtor &&
                ctx.truth.get(CREDIT, id)?.unit === unit,
            );
          if (id === undefined) continue;
          for (const [who, other, role] of [
            [debtor, creditor, "debtor"],
            [creditor, debtor, "creditor"],
          ] as const)
            note(who, {
              kind: "opened",
              belief: {
                commitment: id,
                kind: "credit",
                openedAt: e.tick,
                role,
                other,
                debtorRef: debtor,
                creditorRef: creditor,
                unit,
                total: grams,
                remaining: grams,
                ...(typeof dueDay === "number" && Number.isFinite(dueDay) && dueDay >= 0
                  ? { dueDay }
                  : {}),
                status: "active",
                originEventId: e.id,
                learnedAt: e.tick,
                confidence: 1,
                sources: [e.id],
              },
            });
          continue;
        }
        const payment = paidIn(e);
        if (payment && Number.isFinite(payment.grams) && payment.grams > 0) {
          const explicit = recordOf(data["payment"])?.["credit"];
          if (explicit !== undefined && typeof explicit !== "string") continue;
          for (const who of [payment.payer, payment.to]) {
            if (!aware(who)) continue;
            const prev = books.get(who) ?? ctx.truth.get(DEBT_BOOK, who);
            const next = observeCreditPayment(
              prev,
              who,
              payment.payer,
              payment.to,
              payment.unit,
              payment.grams,
              e.id,
              e.tick,
              explicit,
            );
            if (next.items.some((b, i) => b !== prev?.items[i])) books.set(who, next);
          }
          continue;
        }
        if (
          e.kind !== "credit.loaned" &&
          e.kind !== "credit.paid" &&
          e.kind !== "credit.defaulted" &&
          e.kind !== "credit.subrogated_paid"
        )
          continue;
        if (e.kind === "credit.defaulted" && numberIn(e, "loss") === undefined) continue;
        const subrogatedPayment = e.kind === "credit.subrogated_paid";
        const id = subrogatedPayment ? data["commitment"] : data["loan"];
        if (typeof id !== "string") continue;
        const contract = ctx.truth.get(COMMITMENTS, id as never);
        if (contract?.kind !== (subrogatedPayment ? "subrogation" : "loan")) continue;
        const obligation = contract.obligations[0];
        if (obligation?.duty.kind !== "deliver") continue;
        if (
          subrogatedPayment &&
          (data["unit"] !== obligation.duty.unit || data["parent"] !== contract.parent)
        )
          continue;
        const actors = e.actors as readonly AgentId[];
        const debtor = actors[e.kind === "credit.loaned" ? 1 : 0];
        const creditor = actors[e.kind === "credit.loaned" ? 0 : 1];
        if (
          !debtor ||
          !creditor ||
          ctx.truth.get(PERSON, debtor)?.household !== obligation.debtor ||
          ctx.truth.get(PERSON, creditor)?.household !== obligation.creditor
        )
          continue;
        for (const [who, other, role] of [
          [debtor, creditor, "debtor"],
          [creditor, debtor, "creditor"],
        ] as const) {
          if (!aware(who)) continue;
          let observation: DebtObservation;
          if (e.kind === "credit.loaned") {
            const principal = numberIn(e, "principal");
            const rate = numberIn(e, data["disguise"] === undefined ? "rate" : "statedRate");
            const dueDay = numberIn(e, "dueDay");
            if (
              contract.originEventId !== e.id ||
              principal === undefined ||
              rate === undefined ||
              dueDay === undefined ||
              typeof data["unit"] !== "string"
            )
              continue;
            const total = principal + Math.round(principal * rate);
            if (!Number.isFinite(total) || total <= 0) continue;
            observation = {
              kind: "opened",
              belief: {
                commitment: contract.id,
                kind: "loan",
                role,
                other,
                debtorRef: obligation.debtor,
                creditorRef: obligation.creditor,
                unit: data["unit"],
                total,
                remaining: total,
                dueDay,
                status: "active",
                originEventId: e.id,
                learnedAt: e.tick,
                confidence: 1,
                sources: [e.id],
              },
            };
          } else if (e.kind === "credit.paid" || subrogatedPayment) {
            const amount = numberIn(e, "paid");
            if (amount === undefined) continue;
            const left = subrogatedPayment ? numberIn(e, "left") : undefined;
            if (subrogatedPayment && left === undefined) continue;
            observation = {
              kind: "paid",
              commitment: contract.id,
              amount,
              event: e.id,
              at: e.tick,
              fulfilled: subrogatedPayment ? left === 0 : data["status"] === "repaid",
              ...(left === undefined ? {} : { knownRemaining: left }),
            };
          } else {
            const remaining = numberIn(e, "loss");
            if (remaining === undefined) continue;
            observation = {
              kind: "resolved",
              commitment: contract.id,
              remaining,
              status: remaining === 0 ? "settled" : "defaulted",
              event: e.id,
              at: e.tick,
            };
          }
          note(who, observation);
        }
        if (e.kind !== "credit.defaulted") continue;
        for (const n of subrogationsIn(e)) {
          const sub = ctx.truth.get(COMMITMENTS, n.commitment as never);
          const duty = sub?.obligations[0];
          if (
            sub?.kind !== "subrogation" ||
            sub.parent !== contract.id ||
            sub.originEventId !== e.id ||
            duty?.duty.kind !== "deliver" ||
            duty.debtor !== n.debtorRef ||
            duty.creditor !== n.creditorRef ||
            duty.duty.unit !== n.unit ||
            n.debtor !== debtor ||
            ctx.truth.get(PERSON, n.debtor)?.household !== n.debtorRef ||
            ctx.truth.get(PERSON, n.creditor)?.household !== n.creditorRef
          )
            continue;
          for (const [who, other, role] of [
            [n.debtor, n.creditor, "debtor"],
            [n.creditor, n.debtor, "creditor"],
          ] as const) {
            note(who, {
              kind: "opened",
              belief: {
                commitment: n.commitment,
                kind: "subrogation",
                parent: contract.id,
                role,
                other,
                debtorRef: n.debtorRef,
                creditorRef: n.creditorRef,
                unit: n.unit,
                total: n.qty,
                remaining: n.qty,
                dueDay: n.dueDay,
                status: "active",
                originEventId: e.id,
                learnedAt: e.tick,
                confidence: 1,
                sources: [e.id],
              },
            });
          }
        }
      }
      return books.size === 0
        ? {}
        : {
            changes: [...books]
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([who, book]) => setComponent(DEBT_BOOK, who, book)),
          };
    },
  };
}
