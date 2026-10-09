// El presupuesto de un hogar leído de la vida (economy §3): quiénes comen, cuántas monedas hay en
// las bolsas, cuánto grano en la despensa. Solo lee: no mueve nada. Lo que sale es el tope de gasto
// que el trato respeta (compras de NPC) y cómo está el hogar (`standing`) para las decisiones.

import {
  type AgentId,
  type Duration,
  type HolderRef,
  holderAccount,
  type Tick,
} from "../../core/index.ts";
import {
  availableCoins,
  ENTITY,
  type GoodDef,
  goodUnit,
  type HouseholdFlows,
  type HouseholdStanding,
  type LoanCommitment,
  PERSON,
  type ReadonlyLedger,
  type ReadonlyWorldTruth,
  spendCeiling,
  standing,
  withLoanPayments,
} from "../../sim/index.ts";

/** Desde qué edad se cuenta como adulto (la misma que `ADULT_AGE_YEARS`). */
const ADULT_AGE_YEARS = 10;

/** Kilos de grano que come por día un adulto (700 g, como `GRAIN_EATEN_PER_PERSON_DAY_G`). */
const GRAIN_KG_PER_ADULT_DAY = 0.7;
const ELDER_AGE_YEARS = 60;

export interface BudgetEnv {
  readonly goods: readonly GoodDef[];
  readonly ledger: ReadonlyLedger | undefined;
  readonly now: Tick;
  readonly day: Duration;
  /** Duración del año del planeta; sin ella todos cuentan como adultos. */
  readonly year?: Duration;
  /** Ingreso medio por día del hogar (hoy no hay jornales: 0 hasta que existan). */
  readonly incomePerDay?: number;
  readonly fixedPerDay?: number;
  /** Préstamos activos del hogar: su cuota diaria se suma a los gastos fijos (`withLoanPayments`). */
  readonly loans?: readonly LoanCommitment[];
}

/** Los flujos del hogar `home` como los ve el presupuesto: miembros vivos, bolsas, despensa. */
export function householdFlowsOf(
  truth: ReadonlyWorldTruth,
  env: BudgetEnv,
  home: string,
): HouseholdFlows {
  let adults = 0;
  let children = 0;
  let elders = 0;
  let coins = 0;
  const coin = env.goods.find((g) => g.form === "coin");
  const grain = env.goods.find((g) => g.id === "grain");
  const balance = (holder: HolderRef, g: GoodDef | undefined): number =>
    g && env.ledger ? env.ledger.balance(holderAccount(holder), goodUnit(g)) : 0;
  for (const id of truth.ids(PERSON)) {
    const p = truth.get(PERSON, id);
    if (p?.household !== home || truth.get(ENTITY, id)?.endedAt !== undefined) continue;
    const age = env.year === undefined ? ADULT_AGE_YEARS : (env.now - p.born) / env.year;
    if (age < ADULT_AGE_YEARS) children++;
    else if (age >= ELDER_AGE_YEARS) elders++;
    else adults++;
    coins += balance(id as AgentId as unknown as HolderRef, coin);
  }
  coins += balance(home as unknown as HolderRef, coin);
  const perDayKg = Math.max(0.001, adults + children * 0.6 + elders * 0.8) * GRAIN_KG_PER_ADULT_DAY;
  const pantryDays = balance(home as unknown as HolderRef, grain) / 1000 / perDayKg;
  const flows: HouseholdFlows = {
    coins,
    incomePerDay: env.incomePerDay ?? 0,
    fixedPerDay: env.fixedPerDay ?? 0,
    foodCoinsPerAdultDay: GRAIN_KG_PER_ADULT_DAY * (grain?.priceCopperPerKg ?? 0),
    pantryDays,
    adults,
    children,
    elders,
  };
  return env.loans && env.loans.length > 0
    ? withLoanPayments(flows, env.loans, Math.floor(env.now / env.day))
    : flows;
}

/** Cuántas monedas puede soltar el hogar en un trato: urgente usa todo lo que hay. */
export function coinCeilingOf(flows: HouseholdFlows, urgent: boolean): number {
  return Math.floor(spendCeiling(flows, urgent));
}

export type { HouseholdStanding };
export { availableCoins };
export const standingOf = (flows: HouseholdFlows): HouseholdStanding => standing(flows);
