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
  ENTITY,
  type MediumInput,
  PERSON,
  type ProcessDef,
  setComponent,
  table,
} from "../../sim/index.ts";
import { COMMITMENTS } from "./loans.ts";

export interface DebtBelief {
  readonly commitment: string;
  readonly role: "debtor" | "creditor";
  readonly other: AgentId;
  /** Referencias del acuerdo; no convierten a todo el hogar en observador. */
  readonly debtorRef: string;
  readonly creditorRef: string;
  readonly unit: string;
  readonly total: number;
  readonly remaining: number;
  readonly dueDay: number;
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
            : Math.max(0, b.remaining - observation.amount)
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
  const v = (e.data as Record<string, unknown>)[key];
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
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
    reads: [DEBT_BOOK.name, COMMITMENTS.name, PERSON.name, ENTITY.name, BODY_STATE.name],
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
      for (const e of ctx.recent) {
        if (e.kind !== "credit.loaned" && e.kind !== "credit.paid" && e.kind !== "credit.defaulted")
          continue;
        const data = e.data as Record<string, unknown>;
        if (typeof data.loan !== "string") continue;
        const contract = ctx.truth.get(COMMITMENTS, data.loan as never);
        if (contract?.kind !== "loan") continue;
        const obligation = contract.obligations[0];
        if (obligation?.duty.kind !== "deliver") continue;
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
          const prev = books.get(who) ?? ctx.truth.get(DEBT_BOOK, who);
          let observation: DebtObservation;
          if (e.kind === "credit.loaned") {
            const principal = numberIn(e, "principal");
            const rate = numberIn(e, data.disguise === undefined ? "rate" : "statedRate");
            const dueDay = numberIn(e, "dueDay");
            if (
              contract.originEventId !== e.id ||
              principal === undefined ||
              rate === undefined ||
              dueDay === undefined ||
              typeof data.unit !== "string"
            )
              continue;
            const total = principal + Math.round(principal * rate);
            if (!Number.isFinite(total) || total <= 0) continue;
            observation = {
              kind: "opened",
              belief: {
                commitment: contract.id,
                role,
                other,
                debtorRef: obligation.debtor,
                creditorRef: obligation.creditor,
                unit: data.unit,
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
          } else if (e.kind === "credit.paid") {
            const amount = numberIn(e, "paid");
            if (amount === undefined) continue;
            observation = {
              kind: "paid",
              commitment: contract.id,
              amount,
              event: e.id,
              at: e.tick,
              fulfilled: data.status === "repaid",
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
          const next = observeDebt(prev, observation);
          if (next.items.some((b, i) => b !== prev?.items[i])) books.set(who, next);
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
