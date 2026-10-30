// El queso (livestock-milk-cheese): la leche se pudre en días y el queso dura meses. Cada día, la
// casa que tiene más leche de la que toma su gente (`keepGramsPerPerson` por persona viva) y junta
// `minGrams` de sobra la cuaja: la leche sobrante sale de su despensa a `CHEESE_PRESS` y vuelve
// como queso, la parte que queda (el resto es suero). El cuajo, la sal, el trabajo de quien lo
// hace, el oficio y la maduración no cuentan todavía.

import {
  type BuildingId,
  externalAccount,
  type HouseholdId,
  holderAccount,
  type LedgerUnit,
} from "../../core/index.ts";
import { PERSON } from "../family/index.ts";
import {
  draftEvent,
  type EventDraft,
  type PostingDraft,
  type ProcessDef,
} from "../scheduler/index.ts";
import { BUILDING } from "../settlements/index.ts";
import { ENTITY } from "../world/index.ts";

/** La prensa: adonde va la leche que se cuaja y de donde sale el queso (fuente y sumidero). */
export const CHEESE_PRESS = "cheese_press";

export const CHEESE_PROCESS = "living.cheese";

/** Cómo se cuaja un bien: en qué se vuelve, qué parte queda, desde cuánto y cuánto se guarda. */
export interface CurdRule {
  readonly from: LedgerUnit;
  readonly into: LedgerUnit;
  readonly yield: number;
  /** Desde cuántos gramos de sobra la casa hace queso. */
  readonly minGrams: number;
  /** Lo que la casa guarda para tomar, por persona viva. */
  readonly keepGramsPerPerson: number;
}

export interface CheeseOptions {
  readonly rules: readonly CurdRule[];
}

/**
 * Cada día, por casa (en el orden de su primer edificio): de cada bien que se cuaja, lo que pasa de
 * lo que guarda para su gente, si llega a `minGrams`, se vuelve queso en un evento
 * `living.cheese_made` causado por la leche de la casa.
 */
export function cheeseProcess(o: CheeseOptions): ProcessDef {
  return {
    id: CHEESE_PROCESS,
    system: "living",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "settle",
    reads: [BUILDING.name, ENTITY.name, PERSON.name],
    writes: [],
    scopeGuard: () => o.rules.length > 0,
    run(ctx) {
      const ledger = ctx.ledger;
      if (!ledger) return {};
      const people = new Map<HouseholdId, number>();
      for (const id of [...ctx.truth.ids(PERSON)].sort()) {
        const h = ctx.truth.get(PERSON, id)?.household;
        if (h === undefined || ctx.truth.get(ENTITY, id)?.endedAt !== undefined) continue;
        people.set(h, (people.get(h) ?? 0) + 1);
      }
      const events: EventDraft[] = [];
      const postings: PostingDraft[] = [];
      const seen = new Set<HouseholdId>();
      for (const id of [...ctx.truth.ids(BUILDING)].sort() as BuildingId[]) {
        const b = ctx.truth.get(BUILDING, id);
        const household = b?.household;
        if (!b || household === undefined || seen.has(household)) continue;
        if (ctx.truth.get(ENTITY, id)?.endedAt !== undefined) continue;
        seen.add(household);
        for (const rule of o.rules) {
          const have = Math.floor(ledger.balance(holderAccount(household), rule.from));
          const keep = (people.get(household) ?? 0) * rule.keepGramsPerPerson;
          const spare = have - keep;
          if (spare < rule.minGrams) continue;
          const grams = Math.floor(spare * rule.yield);
          const ev = draftEvent(events.length);
          events.push({
            kind: "living.cheese_made",
            actors: [],
            place: { kind: "building", building: id },
            data: { household, from: rule.from, into: rule.into, used: spare, grams },
            causes: [{ kind: "state", entity: id, key: "milk" }],
            emissions: null,
          });
          postings.push({
            event: ev,
            transfers: [
              {
                unit: rule.from,
                from: holderAccount(household),
                to: externalAccount(CHEESE_PRESS),
                amount: spare,
              },
              ...(grams > 0
                ? [
                    {
                      unit: rule.into,
                      from: externalAccount(CHEESE_PRESS),
                      to: holderAccount(household),
                      amount: grams,
                    },
                  ]
                : []),
            ],
          });
        }
      }
      return events.length > 0 ? { events, postings } : {};
    },
  };
}
