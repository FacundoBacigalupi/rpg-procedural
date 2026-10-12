// Registros derivados de tratos ya resueltos: un escritor acumula todos los eventos del paso.
import type { AgentId, EntityRef, PlanetClock } from "../../core/index.ts";
import {
  type GoodDef,
  goodUnit,
  learnFromDeal,
  MARKET_TAPE,
  noteSeller,
  PERSON,
  PRICE_BELIEFS,
  type ProcessDef,
  qualityPriceFactor,
  RECEIPT_WINDOW_DAYS,
  REFERENCE_QUALITY,
  recordDeal,
  SALE_RECEIPTS,
  SELLER_DAY,
  type StateChange,
  setComponent,
  type TapeEntry,
  type VerbEffect,
  withReceipt,
} from "../../sim/index.ts";

export function tradeProjectionProcess(o: {
  readonly clock: PlanetClock;
  readonly goods: readonly GoodDef[];
}): ProcessDef {
  const refs = new Map(o.goods.map((g) => [goodUnit(g) as string, g.priceCopperPerKg]));
  return {
    id: "life.trade_projection",
    system: "life",
    scope: "world",
    cadence: { local: "onEvent", scene: "onEvent" },
    representation: "individual",
    phase: "physics",
    withRecent: true,
    reads: [PERSON.name, MARKET_TAPE.name, PRICE_BELIEFS.name, SALE_RECEIPTS.name, SELLER_DAY.name],
    writes: [MARKET_TAPE.name, PRICE_BELIEFS.name, SALE_RECEIPTS.name, SELLER_DAY.name],
    run(ctx) {
      const tapes = new Map<EntityRef, readonly TapeEntry[]>();
      const prices = new Map<AgentId, NonNullable<ReturnType<typeof learnFromDeal>>>();
      const sales = new Map<EntityRef, { receipts: ReturnType<typeof withReceipt> }>();
      const sellers = new Map<AgentId, ReturnType<typeof noteSeller>>();
      for (const event of [...ctx.recent].sort(
        (a, b) => a.tick - b.tick || Number(a.id.slice(6)) - Number(b.id.slice(6)),
      )) {
        if (event.kind !== "action.trade") continue;
        const data = event.data as {
          effect?: VerbEffect;
          marketProjection?: { market?: EntityRef; witnesses: readonly AgentId[] };
        };
        const eff = data.effect;
        const projection = data.marketProjection;
        const me = event.actors[0] as AgentId | undefined;
        if (!projection || !me || eff?.kind !== "trade" || !eff.with) continue;
        const other = eff.with as AgentId;
        const day = Math.floor(event.tick / o.clock.day);
        const note = (seller: AgentId, unit: string, grams: number, sold: number) =>
          sellers.set(
            seller,
            noteSeller(
              sellers.get(seller) ?? ctx.truth.get(SELLER_DAY, seller),
              day,
              unit,
              grams,
              sold,
            ),
          );
        if (eff.deal && eff.direction !== null && eff.good !== null && eff.grams > 0) {
          const seller = eff.direction === "sell" ? me : other;
          const buyer = seller === me ? other : me;
          const unit = eff.good as string;
          note(seller, unit, eff.grams, eff.grams);
          const ref = refs.get(unit);
          const paid =
            ((eff.coins / eff.grams) * 1000) / qualityPriceFactor(eff.quality ?? REFERENCE_QUALITY);
          if (ref === undefined || paid <= 0) continue;
          const entry: TapeEntry = {
            day,
            unit,
            grams: eff.grams,
            coins: (paid * eff.grams) / 1000,
            seller,
            buyer,
          };
          const market = projection.market ?? seller;
          tapes.set(
            market,
            recordDeal(tapes.get(market) ?? ctx.truth.get(MARKET_TAPE, market) ?? [], entry),
          );
          const home = ctx.truth.get(PERSON, seller)?.household as EntityRef | undefined;
          if (home !== undefined && eff.coins > 0)
            sales.set(home, {
              receipts: withReceipt(
                sales.get(home)?.receipts ?? ctx.truth.get(SALE_RECEIPTS, home)?.receipts ?? [],
                day,
                eff.coins,
                RECEIPT_WINDOW_DAYS,
              ),
            });
          const learners = new Map<AgentId, "party" | "witness">(
            projection.witnesses.map((id) => [id, "witness"]),
          );
          learners.set(me, "party");
          learners.set(other, "party");
          for (const [id, role] of [...learners].sort((a, b) => (a[0] < b[0] ? -1 : 1)))
            prices.set(
              id,
              learnFromDeal(prices.get(id) ?? ctx.truth.get(PRICE_BELIEFS, id), entry, ref, role),
            );
        } else if (eff.unsold !== undefined && eff.unsold.grams > 0)
          note(
            eff.unsold.seller === "actor" ? me : other,
            eff.unsold.good as string,
            eff.unsold.grams,
            0,
          );
      }
      const changes: StateChange[] = [];
      for (const [id, value] of tapes) changes.push(setComponent(MARKET_TAPE, id, value));
      for (const [id, value] of prices) changes.push(setComponent(PRICE_BELIEFS, id, value));
      for (const [id, value] of sales) changes.push(setComponent(SALE_RECEIPTS, id, value));
      for (const [id, value] of sellers) changes.push(setComponent(SELLER_DAY, id, value));
      return { changes };
    },
  };
}
