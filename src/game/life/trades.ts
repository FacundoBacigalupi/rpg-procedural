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
  type Tick,
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
  pooledCollection,
  productionTransfers,
  RECEIPT_WINDOW_DAYS,
  type ReadonlyWorldTruth,
  SALE_RECEIPTS,
  setComponent,
  TRADE_RECEIPTS,
  type TradeRecipeDef,
  table,
  WORK_HOURS_PER_DAY,
  WORKSHOP,
  WORKSHOP_WASTE,
  wageDue,
  wagePerDay,
  wageTransfer,
} from "../../sim/index.ts";

/** Igual a ROUTINE.workAge (no se importa routine.ts: ciclo con act.ts). */
export const WORK_AGE = 10;

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
  /** Opt-in: los oficios salen de `TRADE_CHOICE` (elegidos por habilidad), no del seed. */
  readonly chosen?: boolean;
  /** Jornal de base por día de trabajo, en monedas (calibración abierta). */
  readonly baseWagePerDay?: number;
  /** Qué parte de su jornal aporta esta persona a la bolsa común (0 a 1); por defecto `WAGE_POOL_SHARE`. */
  readonly poolShareOf?: (truth: ReadonlyWorldTruth, who: AgentId, now: Tick) => number;
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
  const wages = truth.get(TRADE_RECEIPTS, home as never)?.receipts ?? [];
  const sales = truth.get(SALE_RECEIPTS, home as never)?.receipts ?? [];
  return meanIncomePerDay([...wages, ...sales], today, RECEIPT_WINDOW_DAYS);
}

/** El oficio elegido por un hogar (por habilidad y necesidad), con el día en que lo eligió. */
export interface TradeChoice {
  readonly recipe: string;
  readonly day: number;
}
/** Elección guardada por hogar (id del hogar como clave); la escribe solo `life.trade_choice`. */
export const TRADE_CHOICE = table<TradeChoice>("economy.trade_choice");

/**
 * Los hogares con oficio: las asignaciones explícitas; con `chosen`, las elecciones guardadas en
 * `TRADE_CHOICE`; si no hay ni una cosa ni la otra y hay `seed`, las derivadas de la población.
 */
export function tradeAssignments(
  truth: ReadonlyWorldTruth,
  o: Pick<TradesOptions, "assignments" | "seed" | "recipes" | "chosen">,
  adultsByHome: ReadonlyMap<string, number>,
): TradeAssignment[] {
  const out: TradeAssignment[] = [...o.assignments];
  if (o.chosen) {
    const explicit = new Set(out.map((a) => a.household));
    for (const id of [...truth.ids(TRADE_CHOICE)].sort()) {
      const c = truth.get(TRADE_CHOICE, id);
      if (c && !explicit.has(id as string)) out.push({ household: id as string, recipe: c.recipe });
    }
  } else if (o.assignments.length === 0 && o.seed !== undefined) {
    for (const [home, n] of adultsByHome) {
      const r = tradeOfHousehold(o.seed, home, n, o.recipes);
      if (r) out.push({ household: home, recipe: r.id });
    }
  }
  return out;
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
    reads: [PERSON.name, ENTITY.name, TRADE_RECEIPTS.name, SALE_RECEIPTS.name, TRADE_CHOICE.name],
    writes: [TRADE_RECEIPTS.name],
    run(ctx) {
      const ledger = ctx.ledger;
      if (!ledger || !coinDef || (o.assignments.length === 0 && o.seed === undefined && !o.chosen))
        return {};
      const coin = goodUnit(coinDef);
      const days = Math.max(1, ctx.window) / o.clock.day;
      const today = Math.floor(ctx.now / o.clock.day);
      const hoursEach = Math.min(WORK_HOURS_PER_DAY, TRADE_FREE_HOURS * days);
      const adultAge = WORK_AGE;

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

      const assignments = tradeAssignments(
        ctx.truth,
        o,
        new Map([...adults].map(([h, l]) => [h, l.length])),
      );
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
          // El aporte a la bolsa común sale de `pooledCollection` (conserva) con la parte de la persona.
          const share = (o.poolShareOf ?? (() => WAGE_POOL_SHARE))(ctx.truth, w.id, ctx.now);
          wageTransfers.push(
            ...pooledCollection(coin, holderAccount(w.home as unknown as HolderRef), [
              {
                id: w.id,
                account: holderAccount(w.id as unknown as HolderRef),
                coins: pay,
                pooled: share,
              },
            ]).transfers,
          );
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

// --- Elección de oficio por habilidad y necesidad (economy §3), parte pura y opt-in ---------------
// No está cableada: `tradeOfHousehold` (fork keyed) sigue siendo lo que usa la vida. Esto no toca
// RNG ni estado: dado lo que el hogar sabe hacer y lo que le falta, devuelve el oficio que más le
// conviene (o ninguno). Quien lo cablee debe guardar la elección en una tabla propia.

/** Habilidad mínima (0 a 1) del mejor adulto para que el hogar se dedique a un oficio (sin calibrar). */
export const TRADE_MIN_SKILL = 0.15;
/** Peso de la necesidad económica sobre el puntaje (sin calibrar). */
export const TRADE_NEED_WEIGHT = 1;
/** Puntaje mínimo para dedicarse a un oficio (sin calibrar). */
export const TRADE_MIN_SCORE = 0.05;

/** Una receta vista por un hogar: qué tan bien la hace y cuánto rinde la hora. */
export interface TradeCandidate {
  readonly recipe: string;
  /** Habilidad del mejor adulto del hogar en el oficio, 0 a 1. */
  readonly skill: number;
  /** Producto menos insumos por hora de trabajo, en monedas (con los precios que el hogar cree). */
  readonly marginPerHour: number;
  /** Cuánto falta el producto en el lugar, 0 a 1 (1 = nadie lo ofrece). Por defecto 0.5. */
  readonly scarcity?: number;
}

/** Lo que rinde una hora de la receta con los valores por gramo dados (0 si falta algún precio). */
export function recipeMarginPerHour(
  r: TradeRecipeDef,
  valuePerGram: (good: string) => number,
): number {
  const net =
    r.output.amount * valuePerGram(r.output.good) -
    r.inputs.reduce((s, i) => s + i.amount * valuePerGram(i.good), 0);
  return net / Math.max(1e-9, r.hoursPerBatch);
}

/**
 * Puntaje de un oficio para un hogar: rendimiento por hora, escalado por la habilidad y por cuánto
 * falta el producto, más empuje si el hogar necesita ingreso (`need`, 0 a 1: déficit de ingreso
 * contra gasto). Sin rendimiento o sin habilidad suficiente no hay puntaje.
 */
export function tradeScore(c: TradeCandidate, need: number): number {
  if (c.skill < TRADE_MIN_SKILL || c.marginPerHour <= 0) return 0;
  const scarcity = Math.min(1, Math.max(0, c.scarcity ?? 0.5));
  const n = Math.min(1, Math.max(0, need));
  return c.marginPerHour * c.skill * (0.5 + scarcity) * (1 + TRADE_NEED_WEIGHT * n);
}

/**
 * El oficio que elige un hogar entre los candidatos: el de mayor puntaje (empate por id), solo si
 * tiene al menos `TRADE_MIN_ADULTS` adultos y el puntaje llega al mínimo. Determinista, sin RNG.
 */
export function chooseTradeBySkill(
  adults: number,
  candidates: readonly TradeCandidate[],
  need: number,
  minScore: number = TRADE_MIN_SCORE,
): string | undefined {
  if (adults < TRADE_MIN_ADULTS) return undefined;
  let best: { id: string; score: number } | undefined;
  for (const c of candidates) {
    const score = tradeScore(c, need);
    if (score < minScore || score <= 0) continue;
    if (!best || score > best.score || (score === best.score && c.recipe < best.id))
      best = { id: c.recipe, score };
  }
  return best?.id;
}
