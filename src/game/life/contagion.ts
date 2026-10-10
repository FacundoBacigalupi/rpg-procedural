// Contagio de quiebras en la vida (contracts §13, ver `sim/contracts/contagion.ts`): cada día lee los
// `Commitment` activos de `life.loans` como red de deudas entre hogares y los activos líquidos del
// ledger, y calcula la cascada. El hogar que cae por sus propios activos emite `credit.contagion`
// (ronda 0) con causa en los compromisos que lo hunden; el que cae por no cobrar lo emite con causa
// en el evento de cada caído que le faltó (quiebra por quiebra). Solo anota y avisa: no mueve
// bienes (no hay postings), así que conserva por construcción. Cada hogar se anuncia una vez
// mientras siga caído (`CONTAGION_STATE`, en su primer vivo). Proceso opt-in
// (`LifeParts.loanContagion`): apagado no hay filas, RNG ni eventos.

import type { AgentId, EntityRef, HolderRef, PlaceRef } from "../../core/index.ts";
import { holderAccount, ledgerUnit } from "../../core/index.ts";
import {
  contagion,
  debtEdges,
  draftEvent,
  ENTITY,
  type EventDraft,
  PERSON,
  type ProcessDef,
  type ReadonlyWorldTruth,
  type StateChange,
  setComponent,
  table,
} from "../../sim/index.ts";
import { COMMITMENTS, CONTAGION_STATE, commitmentRows } from "./loans.ts";

export const CONTAGION_PROCESS = "life.contagion";
export const CONTAGION_EVENT = "credit.contagion";

export { CONTAGION_STATE };

export interface ContagionOptions {
  /** Unidad de las deudas a limpiar (la de `duty.unit` de los compromisos, p. ej. `coin:copper`). */
  readonly unit: string;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
  /**
   * Opt-in: el hogar que cae por sus propios activos (ronda 0) anota en el evento a quiénes les debía
   * (`data.creditors`); `offenseOf` lo lee como incumplimiento y esos acreedores quedan con su fama
   * rebajada como creencia ajena. Sin esto el evento no lleva `creditors`.
   */
  readonly fame?: boolean;
}

export function contagionProcess(o: ContagionOptions): ProcessDef {
  return {
    id: CONTAGION_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "settle",
    reads: [PERSON.name, ENTITY.name, COMMITMENTS.name, CONTAGION_STATE.name],
    writes: [CONTAGION_STATE.name],
    run(ctx) {
      const ledger = ctx.ledger;
      if (!ledger) return {};
      const rows = commitmentRows(ctx.truth).map((r) => r.commitment);
      const edges = debtEdges(rows, o.unit);
      if (edges.length === 0) return {};
      const firstAlive = (home: string): AgentId | undefined => {
        for (const id of [...ctx.truth.ids(PERSON)].sort()) {
          if (ctx.truth.get(PERSON, id)?.household !== home) continue;
          if (ctx.truth.get(ENTITY, id)?.endedAt === undefined) return id as AgentId;
        }
        return undefined;
      };
      const unit = ledgerUnit(o.unit);
      const assets = new Map<string, number>();
      for (const e of edges)
        for (const h of [e.debtor, e.creditor])
          if (!assets.has(h))
            assets.set(h, ledger.balance(holderAccount(h as unknown as HolderRef), unit) ?? 0);
      const out = contagion(rows, o.unit, assets);
      const failed = new Set(out.failed);
      const creditorsOf = (h: string): AgentId[] =>
        [...new Set(edges.filter((e) => e.debtor === h).map((e) => e.creditor))]
          .sort()
          .flatMap((d) => firstAlive(d) ?? []);
      const events: EventDraft[] = [];
      const changes: StateChange[] = [];
      const index = new Map<string, number>();
      for (const h of [...assets.keys()].sort()) {
        const man = firstAlive(h);
        if (!man) continue;
        const was = ctx.truth.get(CONTAGION_STATE, man)?.failed === true;
        const now = failed.has(h);
        if (was !== now)
          changes.push(setComponent(CONTAGION_STATE, man as EntityRef, { failed: now }));
      }
      // Los caídos en orden de ronda: así la causa de uno ya tiene su evento en el lote.
      for (const h of out.failed) {
        const man = firstAlive(h);
        if (!man || ctx.truth.get(CONTAGION_STATE, man)?.failed === true) continue;
        const why = (out.because.get(h) ?? []).filter((d) => index.has(d));
        const own = edges.filter((e) => e.debtor === h).map((e) => e.commitment);
        const causes =
          why.length > 0
            ? why.map((d) => ({
                kind: "event" as const,
                event: draftEvent(index.get(d) as number) as never,
              }))
            : [...new Set(own)].sort().map((c) => ({
                kind: "state" as const,
                entity: c as unknown as EntityRef,
                key: "obligations",
              }));
        index.set(h, events.length);
        events.push({
          kind: CONTAGION_EVENT,
          actors: [man, ...why.flatMap((d) => firstAlive(d) ?? [])],
          place: o.placeOf(ctx.truth, man),
          data: {
            household: h,
            round: out.round.get(h) ?? 0,
            payRatio: out.payRatio.get(h) ?? 1,
            because: [...why],
            ...(o.fame && why.length === 0 ? { creditors: creditorsOf(h) } : {}),
          },
          emissions: {},
          causes,
        });
      }
      return events.length === 0 && changes.length === 0 ? {} : { events, changes };
    },
  };
}
