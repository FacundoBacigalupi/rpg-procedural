// El oficio de un vecino es lo que se ve, no la verdad (economy §3, information §2). Una vez por
// día, quien comparte hex con miembros de otro hogar que tiene oficio anota en `TRADE_VIEW` que
// ese hogar vive de eso (con el día); si lo cruza y el hogar ya no tiene oficio, borra lo que
// creía. Lo que cree no se actualiza si no se cruzan, y quien nunca vio a un hogar no sabe nada de
// su oficio. Opt-in. Solo escribe su tabla: sin RNG, eventos ni monedas movidas.

import type { AgentId, PlanetClock } from "../../core/index.ts";
import {
  deleteComponent,
  ENTITY,
  LOCATION,
  PERSON,
  type ProcessDef,
  type StateChange,
  setComponent,
  type TradeRecipeDef,
  table,
} from "../../sim/index.ts";
import { TRADE_CHOICE, type TradeAssignment, tradeAssignments, WORK_AGE } from "./trades.ts";

export const TRADE_VIEW_PROCESS = "life.trade_view";

/** Lo que alguien cree del oficio de un hogar ajeno, y desde qué día. */
export interface SeenTrade {
  readonly recipe: string;
  readonly day: number;
}
export interface TradeView {
  readonly homes: Readonly<Record<string, SeenTrade>>;
}
export const TRADE_VIEW = table<TradeView>("economy.trade_view");

export interface TradeViewOptions {
  readonly clock: PlanetClock;
  readonly recipes: readonly TradeRecipeDef[];
  readonly assignments: readonly TradeAssignment[];
  /** Los oficios salen de `TRADE_CHOICE` (como en `tradesProcess`). */
  readonly chosen?: boolean;
}

/** Lo que `book` dice del oficio de `home` (undefined: no se sabe). */
export function tradeBelieved(book: TradeView | undefined, home: string): SeenTrade | undefined {
  return book?.homes[home];
}

/** Aplica lo visto hoy de un hogar (su oficio o ninguno) al libro de quien lo vio (puro). */
export function noticeTrade(
  book: TradeView | undefined,
  home: string,
  recipe: string | undefined,
  day: number,
): TradeView | undefined {
  const homes = { ...(book?.homes ?? {}) };
  if (recipe !== undefined) homes[home] = { recipe, day };
  else if (home in homes) delete homes[home];
  else return book;
  return { homes };
}

export function tradeViewProcess(o: TradeViewOptions): ProcessDef {
  return {
    id: TRADE_VIEW_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "decide",
    reads: [PERSON.name, ENTITY.name, LOCATION.name, TRADE_CHOICE.name, TRADE_VIEW.name],
    writes: [TRADE_VIEW.name],
    run(ctx) {
      const truth = ctx.truth;
      const today = Math.floor(ctx.now / o.clock.day);
      const byHex = new Map<number, { id: AgentId; home: string | undefined }[]>();
      const adults = new Map<string, number>();
      for (const id of [...truth.ids(PERSON)].sort() as AgentId[]) {
        const p = truth.get(PERSON, id);
        if (!p || truth.get(ENTITY, id)?.endedAt !== undefined) continue;
        if (p.household !== undefined && (ctx.now - p.born) / o.clock.year >= WORK_AGE)
          adults.set(p.household, (adults.get(p.household) ?? 0) + 1);
        const at = truth.get(LOCATION, id);
        if (!at) continue;
        const list = byHex.get(at.hex) ?? [];
        list.push({ id, home: p.household });
        byHex.set(at.hex, list);
      }
      const tradeOf = new Map(
        tradeAssignments(
          truth,
          { assignments: o.assignments, recipes: o.recipes, chosen: o.chosen === true },
          adults,
        ).map((a) => [a.household, a.recipe]),
      );
      const changes: StateChange[] = [];
      for (const hex of [...byHex.keys()].sort((a, b) => a - b)) {
        const here = byHex.get(hex) ?? [];
        const homesHere = [
          ...new Set(here.flatMap((p) => (p.home === undefined ? [] : [p.home]))),
        ].sort();
        if (homesHere.length < 2) continue;
        for (const watcher of here) {
          let book = truth.get(TRADE_VIEW, watcher.id);
          const before = book;
          for (const home of homesHere) {
            if (home === watcher.home) continue;
            book = noticeTrade(book, home, tradeOf.get(home), today);
          }
          if (book === before) continue;
          changes.push(
            book && Object.keys(book.homes).length > 0
              ? setComponent(TRADE_VIEW, watcher.id, book)
              : deleteComponent(TRADE_VIEW, watcher.id),
          );
        }
      }
      return { changes };
    },
  };
}
