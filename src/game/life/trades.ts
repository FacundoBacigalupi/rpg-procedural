// Oficios por hogar y jornales cableados a la vida (economy §3). Una vez por día, cada hogar con
// oficio (`TradeAssignment`, explícito: sin asignaciones el proceso no hace nada) produce con las
// horas libres de sus adultos, las que la rutina no usa en el campo, así que no se le quitan
// brazos a la cosecha. Si le sobran insumos y le faltan manos, contrata jornaleros de hogares sin
// oficio al jornal del mercado (`wagePerDay` con brazos y puestos reales), les paga solo lo que
// tiene y todo queda en el ledger: el insumo va al sumidero, el producto sale de la fuente
// nombrada, el jornal pasa de la bolsa del patrón a la del jornalero y este aporta a la bolsa
// común de su casa. Los recibos del hogar del jornalero alimentan su ingreso medio.

import {
  type AgentId,
  type EntityRef,
  externalAccount,
  type HolderRef,
  holderAccount,
  type LedgerAccount,
  type PlaceRef,
  type PlanetClock,
  Rng,
  type Seed,
  type Transfer,
} from "../../core/index.ts";
import {
  batchesPossible,
  draftEvent,
  ENTITY,
  type EventDraft,
  type GoodDef,
  goodUnit,
  type IncomeReceipt,
  meanIncomePerDay,
  PERSON,
  type PostingDraft,
  type ProcessDef,
  productionTransfers,
  RECEIPT_WINDOW_DAYS,
  type ReadonlyWorldTruth,
  setComponent,
  TRADE_RECEIPTS,
  type TradeRecipeDef,
  WORK_HOURS_PER_DAY,
  WORKSHOP,
  WORKSHOP_WASTE,
  wageDue,
  wagePerDay,
  wageTransfer,
} from "../../sim/index.ts";
import { ROUTINE } from "./routine.ts";

export const TRADES_PROCESS = "life.trades";

/** Un hogar con oficio: produce según su receta. */
export interface TradeAssignment {
  readonly household: string;
  readonly recipe: string;
}

/** Parte de los hogares con manos de sobra que se dedican a un oficio (calibración abierta). */
export const TRADE_HOUSEHOLD_SHARE = 0.12;
/** Adultos que hacen falta para que un hogar pueda dedicarse a un oficio sin quitarle brazos al campo. */
export const TRADE_MIN_ADULTS = 2;
/** Tandas de insumos con las que arranca un hogar con oficio (poco: el resto lo compra o lo gana). */
export const TRADE_START_BATCHES = 5;

/**
 * El oficio de un hogar, derivado de la población y no de un escenario: sale de un fork del seed
 * keyed por el hogar (estable aunque cambie la gente) y solo para hogares con al menos
 * `TRADE_MIN_ADULTS` adultos. Sin `adults` suficientes no tiene oficio.
 */
export function tradeOfHousehold(
  seed: Seed,
  household: string,
  adults: number,
  recipes: readonly TradeRecipeDef[],
): TradeRecipeDef | undefined {
  if (recipes.length === 0 || adults < TRADE_MIN_ADULTS) return undefined;
  const rng = Rng.root(seed).fork("trade", household);
  if (!rng.chance(TRADE_HOUSEHOLD_SHARE)) return undefined;
  const sorted = [...recipes].sort((a, b) => (a.id < b.id ? -1 : 1));
  return sorted[rng.int(0, sorted.length - 1)];
}

export interface TradesOptions {
  readonly clock: PlanetClock;
  readonly goods: readonly GoodDef[];
  readonly recipes: readonly TradeRecipeDef[];
  readonly assignments: readonly TradeAssignment[];
  /** Con seed, los hogares sin asignación explícita reciben oficio de la población (`tradeOfHousehold`). */
  readonly seed?: Seed;
  /** Jornal de base por día de trabajo, en monedas (calibración abierta). */
  readonly baseWagePerDay?: number;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

/** Horas por día que un adulto tiene fuera de dormir, comer y el campo (calibración abierta). */
export const TRADE_FREE_HOURS = 4;
/** Jornal de base por día (monedas de cobre; calibración abierta). */
export const BASE_WAGE_PER_DAY = 12;
/** Parte de lo que gana un jornalero que aporta a la bolsa común de su casa. */
export const WAGE_POOL_SHARE = 0.7;

/** El ingreso medio por día de un hogar a partir de sus recibos (para `BudgetEnv.incomePerDay`). */
export function incomeOfHousehold(truth: ReadonlyWorldTruth, home: string, today: number): number {
  const book = truth.get(TRADE_RECEIPTS, home as never);
  return book ? meanIncomePerDay(book.receipts, today, RECEIPT_WINDOW_DAYS) : 0;
}

export function tradesProcess(o: TradesOptions): ProcessDef {
  const recipeOf = new Map(o.recipes.map((r) => [r.id, r]));
  const coinDef = o.goods.find((g) => g.form === "coin");
  const goodDef = new Map(o.goods.map((g) => [g.id, g]));
  const unitOf = (good: string) => {
    const g = goodDef.get(good);
    if (!g) throw new TypeError(`bien desconocido en un oficio: ${good}`);
    return goodUnit(g);
  };
  const valuePerGram = (good: string) => (goodDef.get(good)?.priceCopperPerKg ?? 0) / 1000;
  return {
    id: TRADES_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "act",
    reads: [PERSON.name, ENTITY.name, TRADE_RECEIPTS.name],
    writes: [TRADE_RECEIPTS.name],
    run(ctx) {
      const ledger = ctx.ledger;
      if (!ledger || !coinDef || (o.assignments.length === 0 && o.seed === undefined)) return {};
      const coin = goodUnit(coinDef);
      const days = Math.max(1, ctx.window) / o.clock.day;
      const today = Math.floor(ctx.now / o.clock.day);
      const hoursEach = Math.min(WORK_HOURS_PER_DAY, TRADE_FREE_HOURS * days);
      const adultAge = ROUTINE.workAge;

      // Adultos vivos por hogar.
      const adults = new Map<string, AgentId[]>();
      for (const id of [...ctx.truth.ids(PERSON)].sort()) {
        const p = ctx.truth.get(PERSON, id);
        if (!p || p.household === undefined || ctx.truth.get(ENTITY, id)?.endedAt !== undefined)
          continue;
        if ((ctx.now - p.born) / o.clock.year < adultAge) continue;
        const list = adults.get(p.household) ?? [];
        list.push(id as AgentId);
        adults.set(p.household, list);
      }

      // Saldos locales: lo que cada cuenta tiene al empezar menos lo ya comprometido hoy.
      const delta = new Map<string, number>();
      const key = (a: LedgerAccount, u: string) => `${a}|${u}`;
      const bal = (a: LedgerAccount, u: string) =>
        (ledger.balance(a, u as never) ?? 0) + (delta.get(key(a, u)) ?? 0);
      const apply = (ts: readonly Transfer[]) => {
        for (const t of ts) {
          delta.set(key(t.from, t.unit), (delta.get(key(t.from, t.unit)) ?? 0) - t.amount);
          delta.set(key(t.to, t.unit), (delta.get(key(t.to, t.unit)) ?? 0) + t.amount);
        }
      };

      const assignments: TradeAssignment[] = [...o.assignments];
      if (o.assignments.length === 0 && o.seed !== undefined) {
        for (const [home, list] of adults) {
          const r = tradeOfHousehold(o.seed, home, list.length, o.recipes);
          if (r) assignments.push({ household: home, recipe: r.id });
        }
      }
      const employers = assignments
        .filter((a) => recipeOf.has(a.recipe) && (adults.get(a.household)?.length ?? 0) > 0)
        .sort((a, b) => (a.household < b.household ? -1 : a.household > b.household ? 1 : 0));
      if (employers.length === 0) return {};
      const employerHomes = new Set(assignments.map((a) => a.household));
      const pool: { id: AgentId; home: string }[] = [];
      for (const [home, list] of [...adults].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
        if (employerHomes.has(home)) continue;
        for (const id of list) pool.push({ id, home });
      }

      const stockOf = (home: string, r: TradeRecipeDef) => {
        const acc = holderAccount(home as unknown as HolderRef);
        return new Map(r.inputs.map((i) => [i.good, bal(acc, unitOf(i.good))]));
      };

      // Mercado de jornales: puestos = manos que faltan para gastar los insumos que sobran.
      let jobs = 0;
      for (const e of employers) {
        const r = recipeOf.get(e.recipe) as TradeRecipeDef;
        const own = (adults.get(e.household)?.length ?? 0) * hoursEach;
        const wanted = batchesPossible(r, 1e6, stockOf(e.household, r)) * r.hoursPerBatch;
        jobs += Math.max(0, Math.ceil((wanted - own) / Math.max(1e-9, hoursEach)));
      }
      const wage = wagePerDay(o.baseWagePerDay ?? BASE_WAGE_PER_DAY, pool.length, jobs);

      const events: EventDraft[] = [];
      const postings: PostingDraft[] = [];
      const earnedBy = new Map<string, number>();
      const receipts = (home: string): readonly IncomeReceipt[] =>
        ctx.truth.get(TRADE_RECEIPTS, home as never)?.receipts ?? [];

      for (const e of employers) {
        const r = recipeOf.get(e.recipe) as TradeRecipeDef;
        const shop = holderAccount(e.household as unknown as HolderRef);
        const members = adults.get(e.household) ?? [];
        let hours = members.length * hoursEach;
        const first = members[0] as AgentId;
        const wageTransfers: Transfer[] = [];
        const stock = stockOf(e.household, r);
        const wanted = batchesPossible(r, 1e6, stock) * r.hoursPerBatch;
        // Lo que rinde una hora de este oficio (producto menos insumos), para saber si conviene pagar.
        const net =
          r.output.amount * valuePerGram(r.output.good) -
          r.inputs.reduce((s, i) => s + i.amount * valuePerGram(i.good), 0);
        const hourValue = net / r.hoursPerBatch;
        const hires: { id: AgentId; home: string; pay: number }[] = [];
        while (hours < wanted && pool.length > 0) {
          const w = pool[0] as { id: AgentId; home: string };
          const pay = wageDue(wage, hoursEach, bal(shop, coin) - spentBy(wageTransfers, shop));
          if (pay <= 0 || pay > hourValue * hoursEach) break;
          pool.shift();
          const ts = wageTransfer(coin, shop, holderAccount(w.id as unknown as HolderRef), pay);
          wageTransfers.push(...ts);
          const pooled = Math.floor(pay * WAGE_POOL_SHARE);
          if (pooled > 0)
            wageTransfers.push({
              unit: coin,
              from: holderAccount(w.id as unknown as HolderRef),
              to: holderAccount(w.home as unknown as HolderRef),
              amount: pooled,
            });
          hires.push({ id: w.id, home: w.home, pay });
          hours += hoursEach;
          earnedBy.set(w.home, (earnedBy.get(w.home) ?? 0) + pay);
        }
        const batches = batchesPossible(r, hours, stock);
        const made = productionTransfers(r, batches, {
          workshop: shop,
          sink: externalAccount(WORKSHOP_WASTE),
          source: externalAccount(WORKSHOP),
          unitOf,
        });
        if (made.length === 0 && wageTransfers.length === 0) continue;
        const k = events.length;
        events.push({
          kind: "household.produced",
          actors: [first],
          place: o.placeOf(ctx.truth, first),
          data: {
            household: e.household,
            recipe: r.id,
            batches,
            hired: hires.length,
            wage: hires.length > 0 ? wage : 0,
          },
          emissions: {},
          causes: [{ kind: "state", entity: e.household as unknown as EntityRef, key: "trade" }],
        });
        const transfers = [...wageTransfers, ...made];
        postings.push({ event: draftEvent(k), transfers });
        apply(transfers);
      }

      // Recibos: lo cobrado por el hogar de cada jornalero, en la ventana.
      const changes = [...earnedBy]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([home, coins]) =>
          setComponent(TRADE_RECEIPTS, home as never, {
            receipts: [
              ...receipts(home).filter((x) => x.day > today - RECEIPT_WINDOW_DAYS),
              { day: today, coins },
            ],
          }),
        );
      if (events.length === 0) return {};
      return { events, postings, changes };
    },
  };
}

function spentBy(ts: readonly Transfer[], from: LedgerAccount): number {
  let s = 0;
  for (const t of ts) if (t.from === from && (t.unit as string).startsWith("coin:")) s += t.amount;
  return s;
}
