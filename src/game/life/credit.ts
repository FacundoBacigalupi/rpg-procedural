// El fiado en la aldea (contracts §1, §3): lo que el mundo hace con las palabras y los gestos de
// los vecinos. Tres cosas, todas leídas de eventos que ya pasaron: un vecino accede a un pedido
// (se abre la deuda, con ese evento de origen), el deudor le da algo al acreedor (se descuenta,
// y si salda, la aldea olvida que no pagaba) y, pasado el plazo y la gracia, el acreedor reclama
// (`law.default`: la deuda queda incumplida y de ahí nace la fama de no pagar, ver deeds.ts).
// Nada se cobra solo: pagar es un `give` del deudor.

import type { AgentId, Duration, Event, LedgerUnit, PlaceRef, Tick } from "../../core/index.ts";
import {
  applyPayment,
  CREDIT,
  type Credit,
  type CreditRow,
  clearDefault,
  createEntity,
  declareDefault,
  ENTITY,
  isOverdue,
  KNOWN_DEEDS,
  lend,
  liveBetween,
  type ProcessDef,
  type ReadonlyWorldTruth,
  type StateChange,
  setComponent,
} from "../../sim/index.ts";

export const CREDIT_PROCESS = "life.credit";
export const ARREARS_PROCESS = "life.arrears";

export interface CreditOptions {
  readonly day: Duration;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

export function creditRows(truth: ReadonlyWorldTruth): CreditRow[] {
  return truth
    .ids(CREDIT)
    .map((id) => ({ id: id as string, credit: truth.get(CREDIT, id) as Credit }));
}

/** Lo que `debtor` le debe a `creditor`, por unidad (lo que «le devuelvo» tiene que pagar). */
export function debtsTo(
  truth: ReadonlyWorldTruth,
  debtor: AgentId,
  creditor: string | null,
): ReadonlyMap<LedgerUnit, number> {
  const owed = new Map<LedgerUnit, number>();
  if (creditor === null) return owed;
  for (const r of liveBetween(creditRows(truth), debtor, creditor as AgentId)) {
    owed.set(r.credit.unit, (owed.get(r.credit.unit) ?? 0) + r.credit.owed);
  }
  return owed;
}

function alive(truth: ReadonlyWorldTruth, id: AgentId): boolean {
  return truth.get(ENTITY, id)?.endedAt === undefined;
}

/** Abre las deudas de los pedidos concedidos y descuenta los pagos. */
export function creditProcess(o: CreditOptions): ProcessDef {
  return {
    id: CREDIT_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "onEvent", scene: "onEvent" },
    representation: "individual",
    phase: "perceive",
    reads: [CREDIT.name, KNOWN_DEEDS.name, ENTITY.name],
    writes: [CREDIT.name, KNOWN_DEEDS.name, ENTITY.name],
    run(ctx) {
      const truth = ctx.truth;
      let rows = creditRows(truth);
      const changes: StateChange[] = [];
      const settledNow: CreditRow[] = [];
      for (const e of ctx.recent) {
        const opened = lentBy(e);
        if (opened) {
          const id = ctx.newId("commitment");
          const credit = lend(
            opened.creditor,
            opened.debtor,
            opened.unit,
            opened.grams,
            e.tick,
            o.day,
          );
          changes.push(createEntity(id, e.id, e.tick), setComponent(CREDIT, id, credit));
          rows = [...rows, { id, credit }];
          continue;
        }
        const paid = paidIn(e);
        if (!paid) continue;
        const changed = applyPayment(rows, paid.payer, paid.to, paid.unit, paid.grams, e.id);
        for (const row of changed) {
          changes.push(setComponent(CREDIT, row.id as never, row.credit));
          rows = rows.map((r) => (r.id === row.id ? row : r));
          if (row.credit.status === "settled") settledNow.push(row);
        }
      }
      // Quien salda deja de ser «el que no paga» para todos los que lo sabían.
      if (settledNow.length > 0) {
        for (const id of truth.ids(KNOWN_DEEDS)) {
          const before = truth.get(KNOWN_DEEDS, id);
          let kept = before;
          for (const r of settledNow) kept = clearDefault(kept, r.credit.debtor, r.credit.creditor);
          if (kept && kept !== before) changes.push(setComponent(KNOWN_DEEDS, id, kept));
        }
      }
      return changes.length === 0 ? {} : { changes };
    },
  };
}

/** Un pedido fiado que el vecino concedió (lo anota `converse` en el evento). */
function lentBy(e: Event) {
  if (e.kind !== "action.speak") return null;
  const data = e.data as { credit?: { unit: LedgerUnit; grams: number } } | null;
  const [creditor, debtor] = e.actors as AgentId[];
  if (!data?.credit || !creditor || !debtor) return null;
  return { creditor, debtor, unit: data.credit.unit, grams: data.credit.grams };
}

/** Un `give` que pasó algo de verdad al otro. */
function paidIn(e: Event) {
  if (e.kind !== "action.give") return null;
  const eff = (
    e.data as { effect?: { kind?: string; to?: string; good?: LedgerUnit; grams?: number } } | null
  )?.effect;
  const [payer] = e.actors as AgentId[];
  if (!payer || eff?.kind !== "give" || !eff.to || !eff.good || !(eff.grams && eff.grams > 0)) {
    return null;
  }
  return { payer, to: eff.to as AgentId, unit: eff.good, grams: eff.grams };
}

/** Todos los días el acreedor mira lo vencido: pasada la gracia, lo reclama. */
export function arrearsProcess(o: CreditOptions): ProcessDef {
  return {
    id: ARREARS_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "decide",
    reads: [CREDIT.name, ENTITY.name],
    writes: [CREDIT.name],
    run(ctx) {
      const truth = ctx.truth;
      const due = creditRows(truth).filter(
        (r) =>
          isOverdue(r.credit, ctx.now, o.day) &&
          alive(truth, r.credit.creditor) &&
          alive(truth, r.credit.debtor),
      );
      if (due.length === 0) return {};
      return {
        changes: due.map((r) => setComponent(CREDIT, r.id as never, declareDefault(r.credit))),
        events: due.map((r) => ({
          kind: "law.default",
          actors: [r.credit.debtor, r.credit.creditor],
          place: o.placeOf(truth, r.credit.creditor),
          data: { credit: r.id, unit: r.credit.unit, owed: r.credit.owed },
          emissions: {},
          causes: [{ kind: "state" as const, entity: r.id as never, key: "overdue" }],
        })),
      };
    },
  };
}

export type { Tick };
