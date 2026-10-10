// Elección del oficio del hogar por habilidad y necesidad (economy §3), cableada y opt-in. Una vez
// por día, cada hogar con al menos `TRADE_MIN_ADULTS` adultos y sin oficio elegido mira las recetas
// que sabe hacer (habilidad real del mejor adulto en la habilidad que la receta pide), cuánto rinde
// la hora con los precios que cree el jefe (`PRICE_BELIEFS`, o el de referencia si no sabe) y cuánto
// necesita ingreso según su presupuesto, y `chooseTradeBySkill` decide. La elección queda en
// `TRADE_CHOICE` (tabla propia: `life.trades` solo la lee) y no se revisa: el oficio es una
// decisión de vida. Sin RNG, sin eventos y sin mover monedas ni gente.

import type { AgentId, HolderRef, PlanetClock } from "../../core/index.ts";
import { holderAccount } from "../../core/index.ts";
import {
  baseFor,
  ENTITY,
  type GoodDef,
  goodUnit,
  levelOf,
  PERSON,
  PRICE_BELIEFS,
  type ProcessDef,
  SKILL_STATE,
  type StateChange,
  setComponent,
  type TradeRecipeDef,
} from "../../sim/index.ts";
import { type HouseholdStanding, householdFlowsOf, standingOf } from "./budget.ts";
import { loansOf } from "./loans.ts";
import {
  chooseTradeBySkill,
  incomeOfHousehold,
  recipeMarginPerHour,
  TRADE_CHOICE,
  type TradeCandidate,
  WORK_AGE,
} from "./trades.ts";

export const TRADE_CHOICE_PROCESS = "life.trade_choice";

export interface TradeChoiceOptions {
  readonly clock: PlanetClock;
  readonly goods: readonly GoodDef[];
  readonly recipes: readonly TradeRecipeDef[];
  /** Qué habilidad pide cada receta (id de receta a id de habilidad); sin entrada, no se elige. */
  readonly skills: Readonly<Record<string, string>>;
}

/** Cuánto necesita ingreso un hogar, 0 a 1, según cómo anda. */
export function incomeNeed(s: HouseholdStanding): number {
  return s === "broke" ? 1 : s === "tight" ? 0.7 : s === "getting-by" ? 0.3 : 0;
}

/** Nivel de oficio de alguien: promedio de ejecución, saber y juicio de la habilidad (skills §2). */
export function tradeSkillLevel(state: Parameters<typeof levelOf>[0]): number {
  return (
    (levelOf(state, "execution") + levelOf(state, "knowledge") + levelOf(state, "judgment")) / 3
  );
}

export function tradeChoiceProcess(o: TradeChoiceOptions): ProcessDef {
  const goodDef = new Map(o.goods.map((g) => [g.id, g]));
  return {
    id: TRADE_CHOICE_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "decide",
    reads: [PERSON.name, ENTITY.name, SKILL_STATE.name, PRICE_BELIEFS.name, TRADE_CHOICE.name],
    writes: [TRADE_CHOICE.name],
    run(ctx) {
      const truth = ctx.truth;
      if (!ctx.ledger || o.recipes.length === 0) return {};
      const today = Math.floor(ctx.now / o.clock.day);
      const adults = new Map<string, AgentId[]>();
      for (const id of [...truth.ids(PERSON)].sort() as AgentId[]) {
        const p = truth.get(PERSON, id);
        if (!p || p.household === undefined || truth.get(ENTITY, id)?.endedAt !== undefined)
          continue;
        if ((ctx.now - p.born) / o.clock.year < WORK_AGE) continue;
        const list = adults.get(p.household) ?? [];
        list.push(id);
        adults.set(p.household, list);
      }
      const changes: StateChange[] = [];
      for (const [home, list] of [...adults].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
        if (truth.get(TRADE_CHOICE, home as never) !== undefined) continue;
        const head = list[0] as AgentId;
        const beliefs = truth.get(PRICE_BELIEFS, head);
        const valuePerGram = (good: string) => {
          const g = goodDef.get(good);
          if (!g || g.priceCopperPerKg === undefined) return 0;
          return baseFor(beliefs, goodUnit(g) as string, g.priceCopperPerKg, today) / 1000;
        };
        const candidates: TradeCandidate[] = [];
        for (const r of o.recipes) {
          const skillId = o.skills[r.id];
          if (skillId === undefined) continue;
          let skill = 0;
          for (const a of list)
            skill = Math.max(skill, tradeSkillLevel(truth.get(SKILL_STATE, a)?.[skillId]));
          candidates.push({
            recipe: r.id,
            skill,
            marginPerHour: recipeMarginPerHour(r, valuePerGram),
          });
        }
        if (candidates.length === 0) continue;
        const need = incomeNeed(
          standingOf(
            householdFlowsOf(
              truth,
              {
                goods: o.goods,
                ledger: ctx.ledger,
                now: ctx.now,
                day: o.clock.day,
                year: o.clock.year,
                incomePerDay: incomeOfHousehold(truth, home, today),
                loans: loansOf(truth, holderAccount(home as unknown as HolderRef)),
              },
              home,
            ),
          ),
        );
        const recipe = chooseTradeBySkill(list.length, candidates, need);
        if (recipe !== undefined)
          changes.push(setComponent(TRADE_CHOICE, home as never, { recipe, day: today }));
      }
      return { changes };
    },
  };
}
