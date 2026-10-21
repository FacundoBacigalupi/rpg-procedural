// El forraje del monte día a día (living-world §8, §9; opt-in `wildHarvest`): el monte tiene un stock en
// pie que rebrota con la productividad de la celda y del que la gente alcanza, por día, lo que da
// `harvestStock` con su esfuerzo de referencia. Eso entra (fuente `wild`) a la cuenta de cada lugar de
// monte hasta completar su parte, y de ahí lo toma el verbo `gather`; el stock en pie baja por lo mismo
// que entró. Si se recolecta de más, mañana alcanza menos por hora; si se deja, el monte se recupera.

import { externalAccount, holderAccount, ledgerUnit, type PlaceId } from "../../core/index.ts";
import {
  draftEvent,
  ECOLOGY,
  forageCapacity,
  forageReach,
  PLACE,
  type ProcessDef,
  type ProcessResult,
  regrowForage,
  setComponent,
  WILD,
} from "../../sim/index.ts";

export const WILD_PROCESS = "life.wild";
/** Fuente del ledger de lo silvestre (el monte que rebrota). */
export const WILD_SOURCE = "wild";
export const FORAGE_UNIT = ledgerUnit("good:forage");
export const WILD_SUPPLIED_EVENT = "wild.supplied";

export interface WildOptions {
  /** Días por tick de reloj: segundos del día. */
  readonly dayTicks: number;
}

export function wildProcess(o: WildOptions): ProcessDef {
  return {
    id: WILD_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "settle",
    reads: [ECOLOGY.name, PLACE.name, WILD.name],
    writes: [WILD.name],
    run(ctx) {
      const [id] = ctx.truth.ids(ECOLOGY);
      const eco = id === undefined ? undefined : ctx.truth.get(ECOLOGY, id);
      if (id === undefined || !eco || !ctx.ledger) return {};
      const forests = ctx.truth
        .ids(PLACE)
        .filter((p) => ctx.truth.get(PLACE, p)?.kind === "forest")
        .sort();
      if (forests.length === 0) return {};
      const days = Math.max(1, ctx.window) / o.dayTicks;
      const capacity = forageCapacity(eco.cell.productivity);
      const prev = ctx.truth.get(WILD, id);
      const standing = regrowForage(prev ? prev.standing : capacity, capacity, prev ? days : 0);
      const reach = forageReach(standing);
      // Cada lugar de monte completa su parte de lo alcanzable hoy; lo que quedó sin tomar sigue ahí.
      const share = Math.floor(reach.grams / forests.length);
      const transfers: NonNullable<ProcessResult["postings"]>[number]["transfers"][number][] = [];
      let minted = 0;
      for (const p of forests) {
        const account = holderAccount({ kind: "place", place: p as unknown as PlaceId });
        const add = Math.max(0, share - Math.floor(ctx.ledger.balance(account, FORAGE_UNIT)));
        if (add > 0) {
          transfers.push({
            unit: FORAGE_UNIT,
            from: externalAccount(WILD_SOURCE),
            to: account,
            amount: add,
          });
          minted += add;
        }
      }
      const changes = [setComponent(WILD, id, { standing: standing - minted, day: ctx.now })];
      if (minted === 0) return { changes };
      return {
        changes,
        events: [
          {
            kind: WILD_SUPPLIED_EVENT,
            actors: [],
            place: { kind: "place", place: forests[0] as unknown as PlaceId },
            data: { minted, standing: Math.round(standing - minted), perHour: reach.perHour },
            emissions: {},
            causes: [{ kind: "state", entity: id as never, key: "ecology" }],
          },
        ],
        postings: [{ event: draftEvent(0), transfers }],
      };
    },
  };
}
