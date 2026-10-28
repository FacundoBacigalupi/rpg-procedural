// Curtir la piel cruda en cuero (livestock-hide-tan): la casa que junta bastante piel (del animal que
// murió o carneó) la pone en la tina; la piel sale de su despensa a `TAN_VAT` ese día (deja de
// pudrirse) y, pasados los días del curtido, vuelve cuero desde la tina, la parte que queda de la
// piel cruda (el resto es agua y carne que se fueron). Una tanda por casa a la vez, en la fila
// `TANNING` de su casa. La corteza, el trabajo y el oficio del curtido no cuentan todavía.

import {
  type BuildingId,
  type Duration,
  type EventId,
  externalAccount,
  type HolderRef,
  holderAccount,
  type LedgerUnit,
  type Tick,
} from "../../core/index.ts";
import {
  deleteComponent,
  draftEvent,
  type EventDraft,
  type PostingDraft,
  type ProcessDef,
  type StateChange,
  setComponent,
} from "../scheduler/index.ts";
import { BUILDING } from "../settlements/index.ts";
import { ENTITY, table } from "../world/index.ts";

/** La tina: adonde va la piel cruda y de donde sale el cuero (fuente y sumidero del ledger). */
export const TAN_VAT = "tan_vat";

export const TANNING_PROCESS = "living.tanning";

/** Cómo se curte un bien: en qué se vuelve, qué parte de los gramos queda y en cuántos días. */
export interface TanRule {
  readonly from: LedgerUnit;
  readonly into: LedgerUnit;
  readonly yield: number;
  readonly days: number;
  /** Desde cuántos gramos la casa arma una tanda. */
  readonly minGrams: number;
}

/** La tanda en la tina de una casa (la fila va en su edificio). */
export interface Tanning {
  readonly household: HolderRef;
  readonly from: LedgerUnit;
  readonly grams: number;
  readonly startedAt: Tick;
  /** El evento con que entró a la tina (lo cita el que la saca). */
  readonly started: EventId;
}

export const TANNING = table<Tanning>("living.tanning");

export interface TanningOptions {
  readonly rules: readonly TanRule[];
  /** Duración del día (ticks). */
  readonly day: Duration;
}

/**
 * Cada día, por casa (en el orden de sus edificios): la tanda que cumplió sus días sale como cuero;
 * si no tiene tanda y junta `minGrams` de un bien que se curte, lo pone todo en la tina.
 */
export function tanningProcess(o: TanningOptions): ProcessDef {
  const byFrom = new Map(o.rules.map((r) => [r.from, r]));
  return {
    id: TANNING_PROCESS,
    system: "living",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "settle",
    reads: [BUILDING.name, ENTITY.name, TANNING.name],
    writes: [TANNING.name],
    scopeGuard: () => o.rules.length > 0,
    run(ctx) {
      const ledger = ctx.ledger;
      if (!ledger) return {};
      const events: EventDraft[] = [];
      const changes: StateChange[] = [];
      const postings: PostingDraft[] = [];
      for (const id of [...ctx.truth.ids(BUILDING)].sort() as BuildingId[]) {
        const b = ctx.truth.get(BUILDING, id);
        const household = b?.household as HolderRef | undefined;
        if (!b || household === undefined || ctx.truth.get(ENTITY, id)?.endedAt !== undefined) {
          continue;
        }
        const batch = ctx.truth.get(TANNING, id);
        if (batch) {
          const rule = byFrom.get(batch.from);
          if (!rule || ctx.now - batch.startedAt < rule.days * o.day) continue;
          const grams = Math.floor(batch.grams * rule.yield);
          const ev = draftEvent(events.length);
          events.push({
            kind: "living.hide_tanned",
            actors: [],
            place: { kind: "building", building: id },
            data: { household, from: batch.from, into: rule.into, grams },
            causes: [{ kind: "event", event: batch.started }],
            emissions: null,
          });
          changes.push(deleteComponent(TANNING, id));
          if (grams > 0) {
            postings.push({
              event: ev,
              transfers: [
                {
                  unit: rule.into,
                  from: externalAccount(TAN_VAT),
                  to: holderAccount(household),
                  amount: grams,
                },
              ],
            });
          }
          continue;
        }
        for (const rule of o.rules) {
          const have = Math.floor(ledger.balance(holderAccount(household), rule.from));
          if (have < rule.minGrams) continue;
          const ev = draftEvent(events.length);
          events.push({
            kind: "living.hide_tanning",
            actors: [],
            place: { kind: "building", building: id },
            data: { household, from: rule.from, grams: have },
            causes: [{ kind: "state", entity: id, key: "hide" }],
            emissions: null,
          });
          changes.push(
            setComponent(TANNING, id, {
              household,
              from: rule.from,
              grams: have,
              startedAt: ctx.now,
              started: ev,
            }),
          );
          postings.push({
            event: ev,
            transfers: [
              {
                unit: rule.from,
                from: holderAccount(household),
                to: externalAccount(TAN_VAT),
                amount: have,
              },
            ],
          });
          break;
        }
      }
      return events.length > 0 ? { events, changes, postings } : {};
    },
  };
}
