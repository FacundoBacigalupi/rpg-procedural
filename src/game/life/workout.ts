// Salida de la deuda del hogar caído (contracts §5, §13): cada día, por cada compromiso activo cuyo
// deudor está caído según `life.contagion` (`CONTAGION_STATE`), su acreedor elige entre renegociar
// (`restructure`: plazo y quita) y ejecutar la garantía (`seize`). Elige por lo que cree del deudor
// (su confianza hacia él, la fama como creencia propia) y por cuánto cubre el colateral lo debido:
// si lo cubre entero o la fama es mala ejecuta lo que vale; si no lo cubre y la fama es buena
// renegocia; si ni hay prenda ni fama no hace nada. Ejecutar mueve los lotes en prenda del
// deudor al acreedor por el ledger (postings, tope el saldo real): conserva por construcción.
// Cada compromiso se renegocia una sola vez. Proceso opt-in (`LifeParts.loanWorkout`, con
// `loanContagion`): apagado no hay filas, RNG ni eventos.

import type { AgentId, EntityRef, HolderRef, LedgerAccount, PlaceRef } from "../../core/index.ts";
import { holderAccount, ledgerUnit } from "../../core/index.ts";
import {
  type Commitment,
  commitmentOwed,
  draftEvent,
  ENTITY,
  type EventDraft,
  PERSON,
  type PostingDraft,
  type ProcessDef,
  RELATIONS,
  type ReadonlyWorldTruth,
  restructure,
  type StateChange,
  seize,
  setComponent,
} from "../../sim/index.ts";
import { COMMITMENTS, CONTAGION_STATE } from "./loans.ts";

export const WORKOUT_PROCESS = "life.workout";
export const WORKOUT_RESTRUCTURED = "credit.restructured";
export const WORKOUT_SEIZED = "credit.seized";

export interface WorkoutOptions {
  /** Unidad de la deuda (la de `duty.unit`). */
  readonly unit: string;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
  /** Ticks por día de mundo (para los plazos nuevos). */
  readonly day: number;
  /** Prendas en lotes del ledger por `ref` de garantía: unidad y cantidad (tope el saldo del deudor). */
  readonly lots: ReadonlyMap<string, { readonly unit: string; readonly amount: number }>;
  /** Valor de una unidad de lote en la unidad de la deuda (por defecto 1 si es la misma, si no 0). */
  readonly priceOf?: (unit: string) => number;
  /** Confianza mínima del acreedor hacia el deudor para renegociar en vez de ejecutar (0.3 por defecto). */
  readonly trustToRenegotiate?: number;
  /** Plazo que se da y fracción que se perdona al renegociar. */
  readonly extendDays?: number;
  readonly forgive?: number;
}

export function workoutProcess(o: WorkoutOptions): ProcessDef {
  const price = (u: string) => o.priceOf?.(u) ?? (u === o.unit ? 1 : 0);
  const threshold = o.trustToRenegotiate ?? 0.3;
  const acct = (h: string): LedgerAccount => holderAccount(h as unknown as HolderRef);
  return {
    id: WORKOUT_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "settle",
    reads: [PERSON.name, ENTITY.name, COMMITMENTS.name, CONTAGION_STATE.name, RELATIONS.name],
    writes: [COMMITMENTS.name, ENTITY.name],
    run(ctx) {
      const ledger = ctx.ledger;
      if (!ledger) return {};
      const firstAlive = (home: string): AgentId | undefined => {
        for (const id of [...ctx.truth.ids(PERSON)].sort()) {
          if (ctx.truth.get(PERSON, id)?.household !== home) continue;
          if (ctx.truth.get(ENTITY, id)?.endedAt === undefined) return id as AgentId;
        }
        return undefined;
      };
      const events: EventDraft[] = [];
      const postings: PostingDraft[] = [];
      const changes: StateChange[] = [];
      const delta = new Map<string, number>();
      const bal = (a: LedgerAccount, u: string) =>
        (ledger.balance(a, u as never) ?? 0) + (delta.get(`${a}|${u}`) ?? 0);
      for (const id of [...ctx.truth.ids(COMMITMENTS)].sort()) {
        const c = ctx.truth.get(COMMITMENTS, id) as Commitment;
        if (c.status !== "active" && c.status !== "defaulted") continue;
        if (c.history.some((h) => h.startsWith("restructure:"))) continue;
        const ob = c.obligations.find(
          (x) => x.duty.unit === o.unit && x.duty.qty - x.performed > 0,
        );
        if (!ob) continue;
        const debtorMan = firstAlive(ob.debtor);
        const creditorMan = firstAlive(ob.creditor);
        if (!debtorMan || !creditorMan) continue;
        if (ctx.truth.get(CONTAGION_STATE, debtorMan)?.failed !== true) continue;
        const owed = commitmentOwed(c);
        // Valor de cada prenda: lo que hay del lote en el deudor, en la unidad de la deuda.
        const values = new Map<string, number>();
        for (const g of c.guarantees) {
          if (g.kind !== "collateral") continue;
          const lot = o.lots.get(g.ref);
          if (!lot) continue;
          const have = Math.min(Math.floor(lot.amount), Math.floor(bal(acct(ob.debtor), lot.unit)));
          values.set(g.ref, Math.max(0, have) * price(lot.unit));
        }
        const cover = [...values.values()].reduce((s, v) => s + v, 0);
        const trust =
          ctx.truth.get(RELATIONS, creditorMan)?.toward[debtorMan as string]?.dims.trust ?? 0;
        const cause = [
          { kind: "state" as const, entity: debtorMan as unknown as EntityRef, key: "failed" },
          { kind: "state" as const, entity: id as unknown as EntityRef, key: "obligations" },
        ];
        const actors = [creditorMan, debtorMan];
        const place = o.placeOf(ctx.truth, creditorMan);
        const executes = cover >= owed - 1e-9 || (cover > 0 && trust < threshold);
        if (executes) {
          const out = seize(c, values);
          if (out.taken <= 0) continue;
          const k = events.length;
          const ts = out.lines.flatMap((l) => {
            const lot = o.lots.get(l.ref);
            if (!lot) return [];
            const amount = Math.floor(l.taken / price(lot.unit));
            return amount > 0
              ? [
                  {
                    unit: ledgerUnit(lot.unit),
                    from: acct(ob.debtor),
                    to: acct(ob.creditor),
                    amount,
                  },
                ]
              : [];
          });
          for (const t of ts) {
            delta.set(`${t.from}|${t.unit}`, (delta.get(`${t.from}|${t.unit}`) ?? 0) - t.amount);
            delta.set(`${t.to}|${t.unit}`, (delta.get(`${t.to}|${t.unit}`) ?? 0) + t.amount);
          }
          events.push({
            kind: WORKOUT_SEIZED,
            actors,
            place,
            data: {
              commitment: id,
              taken: out.taken,
              remaining: out.remaining,
              refs: out.lines.map((l) => l.ref),
              trust,
            },
            emissions: {},
            causes: cause,
          });
          if (ts.length > 0) postings.push({ event: draftEvent(k), transfers: ts });
          changes.push(setComponent(COMMITMENTS, id as never, out.commitment));
        } else if (trust >= threshold) {
          const nid = ctx.newId("commitment");
          const k = events.length;
          const res = restructure(c, {
            day: Math.floor(ctx.now / o.day),
            newId: nid as string,
            extendDays: o.extendDays ?? 30,
            forgive: o.forgive ?? 0.2,
            inReturn: "trust",
            originEventId: draftEvent(k) as unknown as string,
          });
          if (!res) continue;
          events.push({
            kind: WORKOUT_RESTRUCTURED,
            actors,
            place,
            data: { commitment: id, next: nid, forgiven: res.forgiven, trust, cover },
            emissions: {},
            causes: cause,
          });
          changes.push(
            setComponent(COMMITMENTS, id as never, res.old),
            setComponent(
              ENTITY,
              nid as never,
              { id: nid, originEventId: draftEvent(k), createdAt: ctx.now } as never,
            ),
            setComponent(COMMITMENTS, nid as never, res.next),
          );
        }
      }
      return events.length === 0 ? {} : { events, postings, changes };
    },
  };
}
