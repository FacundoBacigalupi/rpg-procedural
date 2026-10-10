// Casa de empeño (contracts §5, economy §8): cada día, por cada compromiso `pawn` activo, el dueño
// de la prenda la recupera si le conviene (lo que cree que vale el lote supera lo debido) y le
// alcanza el saldo en la unidad del préstamo: paga a la casa y el lote vuelve por el ledger
// (`credit.pawn_redeemed`). Vencido el plazo y la gracia, el lote que la casa ya tiene pasa a ser
// suyo (`seize`, `credit.pawn_forfeited`; sin postings: ya estaba en sus manos). Los empeños se
// abren con `openPawn`/`pawnTransfers` (sim/contracts). Opt-in (`LifeParts.pawn`): apagado no hay
// filas, RNG ni eventos.

import type { EntityRef, HolderRef, LedgerAccount, PlaceRef } from "../../core/index.ts";
import { holderAccount, ledgerUnit } from "../../core/index.ts";
import {
  type Commitment,
  commitmentOwed,
  draftEvent,
  type EventDraft,
  forfeitPawn,
  PAWN_KIND,
  type PostingDraft,
  type ProcessDef,
  pawnPhase,
  redeemPawn,
  type StateChange,
  setComponent,
} from "../../sim/index.ts";
import { COMMITMENTS } from "./loans.ts";

export const PAWN_PROCESS = "life.pawn";
export const PAWN_REDEEMED = "credit.pawn_redeemed";
export const PAWN_FORFEITED = "credit.pawn_forfeited";

/** Lotes del ledger por `ref` de prenda: unidad y cantidad. */
export type PawnLots = ReadonlyMap<string, { readonly unit: string; readonly amount: number }>;

export interface PawnOptions {
  /** Unidad del préstamo. */
  readonly unit: string;
  readonly placeOf: () => PlaceRef;
  /** Ticks por día de mundo. */
  readonly day: number;
  /** Lotes del ledger por `ref` de prenda: unidad y cantidad. */
  readonly lots: PawnLots;
  /** Valor creído de una unidad de lote en la unidad del préstamo (1 si es la misma, si no 0). */
  readonly priceOf?: (unit: string) => number;
}

export function pawnProcess(o: PawnOptions): ProcessDef {
  const price = (u: string) => o.priceOf?.(u) ?? (u === o.unit ? 1 : 0);
  const acct = (h: string): LedgerAccount => holderAccount(h as unknown as HolderRef);
  return {
    id: PAWN_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "settle",
    reads: [COMMITMENTS.name],
    writes: [COMMITMENTS.name],
    run(ctx) {
      const ledger = ctx.ledger;
      if (!ledger) return {};
      const day = Math.floor(ctx.now / o.day);
      const events: EventDraft[] = [];
      const postings: PostingDraft[] = [];
      const changes: StateChange[] = [];
      const delta = new Map<string, number>();
      const bal = (a: LedgerAccount, u: string) =>
        (ledger.balance(a, u as never) ?? 0) + (delta.get(`${a}|${u}`) ?? 0);
      const move = (from: LedgerAccount, to: LedgerAccount, unit: string, amount: number) => {
        delta.set(`${from}|${unit}`, (delta.get(`${from}|${unit}`) ?? 0) - amount);
        delta.set(`${to}|${unit}`, (delta.get(`${to}|${unit}`) ?? 0) + amount);
      };
      for (const id of [...ctx.truth.ids(COMMITMENTS)].sort()) {
        const c = ctx.truth.get(COMMITMENTS, id) as Commitment;
        const phase = pawnPhase(c, day);
        if (c.kind !== PAWN_KIND || phase === "closed") continue;
        const ob = c.obligations[0];
        const ref = c.guarantees.find((g) => g.kind === "collateral")?.ref;
        const lot = ref === undefined ? undefined : o.lots.get(ref);
        if (!ob || ref === undefined || !lot) continue;
        const cause = [
          { kind: "state" as const, entity: id as unknown as EntityRef, key: "obligations" },
        ];
        const place = o.placeOf();
        const k = events.length;
        const owed = commitmentOwed(c);
        const lotValue = lot.amount * price(lot.unit);
        if (
          phase !== "forfeit" &&
          lotValue > owed &&
          bal(acct(ob.debtor), o.unit) >= owed &&
          bal(acct(ob.creditor), lot.unit) >= lot.amount
        ) {
          const r = redeemPawn(c, owed);
          if (!r.redeemed) continue;
          move(acct(ob.debtor), acct(ob.creditor), o.unit, r.applied);
          move(acct(ob.creditor), acct(ob.debtor), lot.unit, lot.amount);
          events.push({
            kind: PAWN_REDEEMED,
            actors: [],
            place,
            data: { commitment: id, paid: r.applied, ref, pawner: ob.debtor, broker: ob.creditor },
            emissions: {},
            causes: cause,
          });
          postings.push({
            event: draftEvent(k),
            transfers: [
              {
                unit: ledgerUnit(o.unit),
                from: acct(ob.debtor),
                to: acct(ob.creditor),
                amount: r.applied,
              },
              {
                unit: ledgerUnit(lot.unit),
                from: acct(ob.creditor),
                to: acct(ob.debtor),
                amount: lot.amount,
              },
            ],
          });
          changes.push(setComponent(COMMITMENTS, id as never, r.commitment));
        } else if (phase === "forfeit") {
          const out = forfeitPawn(c, lotValue, ref);
          if (out.taken <= 0) continue;
          events.push({
            kind: PAWN_FORFEITED,
            actors: [],
            place,
            data: {
              commitment: id,
              ref,
              taken: out.taken,
              remaining: out.remaining,
              pawner: ob.debtor,
              broker: ob.creditor,
            },
            emissions: {},
            causes: cause,
          });
          changes.push(setComponent(COMMITMENTS, id as never, out.commitment));
        }
      }
      return events.length === 0 ? {} : { events, postings, changes };
    },
  };
}
