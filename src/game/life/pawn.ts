// Casa de empeño (contracts §5, economy §8): cada día, por cada compromiso `pawn` activo, el dueño
// de la prenda la recupera si le conviene (lo que cree que vale el lote supera lo debido) y le
// alcanza el saldo en la unidad del préstamo: paga a la casa y el lote vuelve por el ledger
// (`credit.pawn_redeemed`). Vencido el plazo y la gracia, el lote que la casa ya tiene pasa a ser
// suyo (`seize`, `credit.pawn_forfeited`; sin postings: ya estaba en sus manos). Los empeños se
// abren con `openPawn`/`pawnTransfers` (sim/contracts). Opt-in (`LifeParts.pawn`): apagado no hay
// filas, RNG ni eventos.

import type { AgentId, EntityRef, HolderRef, LedgerAccount, PlaceRef } from "../../core/index.ts";
import { holderAccount, ledgerUnit } from "../../core/index.ts";
import {
  type Commitment,
  commitmentOwed,
  draftEvent,
  ENTITY,
  type EventDraft,
  forfeitPawn,
  openPawn,
  PAWN_KIND,
  PERSON,
  type PostingDraft,
  type ProcessDef,
  pawnPhase,
  type ReadonlyWorldTruth,
  redeemPawn,
  type StateChange,
  setComponent,
} from "../../sim/index.ts";
import { COMMITMENTS } from "./loans.ts";

export const PAWN_PROCESS = "life.pawn";
export const PAWN_REDEEMED = "credit.pawn_redeemed";
export const PAWN_FORFEITED = "credit.pawn_forfeited";
export const PAWN_OPEN_PROCESS = "life.pawn_open";
export const PAWN_OPENED = "credit.pawn_opened";
export const PAWN_REFUSED = "credit.pawn_refused";

/** Prenda ofrecida desde el verbo: la ref lleva el lote (`lot:<cantidad>*<unidad>`). */
export const pawnLotRef = (amount: number, unit: string) => `lot:${amount}*${unit}`;
const LOT_REF = /^lot:(\d+(?:\.\d+)?)\*(.+)$/;
function lotOfRef(ref: string): { readonly unit: string; readonly amount: number } | undefined {
  const m = LOT_REF.exec(ref);
  return m ? { amount: Number(m[1]), unit: m[2] as string } : undefined;
}

/** Cómo abre empeños la casa cuando el verbo `give` va en prenda (modo `pawn`). */
export interface PawnOpenOptions {
  readonly advance?: number;
  readonly rate?: number;
  readonly termDays?: number;
  /** Valor creído por unidad de lote en la unidad del préstamo (lo que la casa cree, no la verdad). */
  readonly prices?: Readonly<Record<string, number>>;
  /** Tasación creída del prestamista (creencia con error); por defecto `prices`. */
  readonly appraise?: (
    truth: ReadonlyWorldTruth,
    broker: AgentId,
    unit: string,
    amount: number,
  ) => number;
}

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
        const lot = ref === undefined ? undefined : (o.lots.get(ref) ?? lotOfRef(ref));
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

interface GiveFx {
  readonly kind?: string;
  readonly to?: string | null;
  readonly good?: string | null;
  readonly grams?: number;
}

/**
 * Abrir el empeño desde el verbo (`give` con modo `pawn`): el lote ya pasó por el ledger a la
 * cuenta del prestamista; este proceso lo tasa con lo que ÉL cree (`pawnOffer`), le adelanta de su
 * bolsa (asiento) y abre el compromiso con el evento del verbo como causa. Si no hay oferta o no le
 * alcanza el efectivo, devuelve el lote (`credit.pawn_refused`). Opt-in (`LifeParts.pawn.open`).
 */
export function pawnOpenProcess(o: {
  readonly unit: string;
  readonly placeOf: () => PlaceRef;
  readonly day: number;
  readonly open: PawnOpenOptions;
}): ProcessDef {
  const acct = (h: string): LedgerAccount => holderAccount(h as unknown as HolderRef);
  return {
    id: PAWN_OPEN_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "onEvent", scene: "onEvent" },
    representation: "individual",
    phase: "settle",
    reads: [PERSON.name, ENTITY.name],
    writes: [COMMITMENTS.name, ENTITY.name],
    run(ctx) {
      const ledger = ctx.ledger;
      if (!ledger) return {};
      const truth = ctx.truth;
      const events: EventDraft[] = [];
      const postings: PostingDraft[] = [];
      const changes: StateChange[] = [];
      const spent = new Map<string, number>();
      const alive = (id: string) =>
        truth.get(PERSON, id as never) !== undefined &&
        truth.get(ENTITY, id as never)?.endedAt === undefined;
      const today = Math.floor(ctx.now / o.day);
      for (const e of ctx.recent) {
        if (e.kind !== "action.give") continue;
        const d = e.data as {
          manner?: readonly string[];
          effect?: GiveFx;
          failure?: unknown;
        } | null;
        const fx = d?.effect;
        const pawner = e.actors[0] as AgentId | undefined;
        const broker = fx?.to as AgentId | undefined;
        const grams = fx?.grams ?? 0;
        if (!d?.manner?.includes("pawn") || d.failure != null) continue;
        if (!pawner || !broker || fx?.kind !== "give" || !fx.good || grams <= 0) continue;
        if (!alive(pawner) || !alive(broker) || pawner === broker) continue;
        const unit = fx.good;
        const place = o.placeOf();
        const causes = [{ kind: "event" as const, event: e.id }];
        const value = o.open.appraise
          ? o.open.appraise(truth, broker, unit, grams)
          : grams * (o.open.prices?.[unit] ?? (unit === o.unit ? 1 : 0));
        const id = ctx.newId("commitment") as string;
        const k = events.length;
        const opened = openPawn({
          id,
          pawner: pawner as string,
          broker: broker as string,
          ref: pawnLotRef(grams, unit),
          unit: o.unit,
          believedValue: value,
          day: today,
          originEventId: draftEvent(k) as unknown as string,
          ...(o.open.advance !== undefined ? { advance: o.open.advance } : {}),
          ...(o.open.rate !== undefined ? { rate: o.open.rate } : {}),
          ...(o.open.termDays !== undefined ? { termDays: o.open.termDays } : {}),
        });
        const free = Math.floor(
          ledger.balance(acct(broker as string), ledgerUnit(o.unit)) -
            (spent.get(broker as string) ?? 0),
        );
        if (!opened || opened.offer.advance > free) {
          events.push({
            kind: PAWN_REFUSED,
            actors: [pawner, broker],
            place,
            data: { unit, grams, believedValue: value, reason: opened ? "no_cash" : "no_offer" },
            emissions: {},
            causes,
          });
          postings.push({
            event: draftEvent(k),
            transfers: [
              {
                unit: ledgerUnit(unit),
                from: acct(broker as string),
                to: acct(pawner as string),
                amount: grams,
              },
            ],
          });
          continue;
        }
        spent.set(broker as string, (spent.get(broker as string) ?? 0) + opened.offer.advance);
        events.push({
          kind: PAWN_OPENED,
          actors: [pawner, broker],
          place,
          data: {
            commitment: id,
            unit,
            grams,
            advance: opened.offer.advance,
            owed: opened.offer.owed,
            believedValue: value,
          },
          emissions: {},
          causes,
        });
        // El lote ya está en la cuenta de la casa (el verbo lo pasó): solo falta el adelanto.
        postings.push({
          event: draftEvent(k),
          transfers: [
            {
              unit: ledgerUnit(o.unit),
              from: acct(broker as string),
              to: acct(pawner as string),
              amount: opened.offer.advance,
            },
          ],
        });
        changes.push(
          setComponent(
            ENTITY,
            id as never,
            { id, originEventId: draftEvent(k), createdAt: ctx.now } as never,
          ),
          setComponent(COMMITMENTS, id as never, opened.commitment),
        );
      }
      return events.length === 0 ? {} : { events, postings, changes };
    },
  };
}
