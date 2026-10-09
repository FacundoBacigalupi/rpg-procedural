// Cierre del día del vendedor (economy §5). Durante el día `act` anota en `SELLER_DAY` cuánto sacó
// a la venta y cuánto vendió cada vendedor (`noteSeller`); al empezar otro día este proceso diario
// corre su creencia de precio con `endOfDayAdjust` (vendió todo, sube; no vendió, baja) y borra el
// libro. Sin ventas ni ofertas no hay libros: no hace nada, sin RNG ni eventos.

import type { AgentId, PlanetClock } from "../../core/index.ts";
import {
  deleteComponent,
  endOfDayAdjust,
  type GoodDef,
  goodUnit,
  PRICE_BELIEFS,
  type ProcessDef,
  SELLER_DAY,
  type StateChange,
  setComponent,
} from "../../sim/index.ts";

export const MARKET_PROCESS = "life.market";

export interface MarketOptions {
  readonly clock: PlanetClock;
  readonly goods: readonly GoodDef[];
}

export function marketProcess(o: MarketOptions): ProcessDef {
  const ref = new Map(
    o.goods.flatMap((g) =>
      g.priceCopperPerKg === undefined
        ? []
        : [[goodUnit(g) as string, g.priceCopperPerKg] as const],
    ),
  );
  return {
    id: MARKET_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "act",
    reads: [SELLER_DAY.name, PRICE_BELIEFS.name],
    writes: [SELLER_DAY.name, PRICE_BELIEFS.name],
    run(ctx) {
      const ids = ctx.truth.ids(SELLER_DAY);
      if (ids.length === 0) return {};
      const today = Math.floor(ctx.now / o.clock.day);
      const changes: StateChange[] = [];
      for (const id of [...ids].sort()) {
        const book = ctx.truth.get(SELLER_DAY, id);
        if (book === undefined || book.day >= today) continue;
        let beliefs = ctx.truth.get(PRICE_BELIEFS, id as AgentId);
        for (const unit of Object.keys(book.rows).sort()) {
          const price = ref.get(unit);
          if (price === undefined) continue;
          beliefs = endOfDayAdjust(beliefs, unit, price, book.day, book.rows[unit] as never);
        }
        if (beliefs !== undefined)
          changes.push(setComponent(PRICE_BELIEFS, id as AgentId, beliefs));
        changes.push(deleteComponent(SELLER_DAY, id));
      }
      return { changes };
    },
  };
}
