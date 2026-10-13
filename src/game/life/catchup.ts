// Puesta al día de un NPC dormido (simulation §7-§8, tier 1; off-1). Pura: lleva el cuerpo de
// `body.updatedAt` a `to` siguiendo la rutina del día (`routineAt`: duerme, trabaja, descansa, con
// las comidas y el agua de `ROUTINE`) sin simular hora por hora fuera de lo que cambia. Las horas
// seguidas con la misma actividad y sin comida ni bebida en el medio se integran de una sola vez
// con un paso grueso (`advanceBody(…, coarseSeconds)`); las comidas y el agua se aplican en su hora,
// igual que `life.routine`. La ración la pone quien llama (la despensa del hogar es suya): esto
// devuelve cuántos gramos comió, para que los asiente en el libro mayor. `catchUpByHour` es la
// referencia exacta (hora por hora) contra la que se mide el atajo.

import type { AgentId, PlanetClock, Tick } from "../../core/index.ts";
import {
  advanceBody,
  type Body,
  type BodyPlanDef,
  type Happening,
  ingest,
  localHour,
  MEAL_KCAL,
  setActivity,
} from "../../sim/index.ts";
import { ROUTINE, routineAt } from "./routine.ts";

/** Litros máximos que bebe de una vez (como la rutina). */
const MAX_DRINK_L = 1.5;

export interface CatchUpOptions {
  readonly clock: PlanetClock;
  readonly lonDeg: number;
  readonly ageYears: number;
  /** El alimento de la despensa con que come (`FoodDef.kcalPerGram`, `waterPerGram`). */
  readonly ration: { readonly kcalPerGram: number; readonly waterPerGram: number };
  /** Tope de comidas que la despensa alcanza a dar en la ventana; sin tope, todas las de la rutina. */
  readonly maxMeals?: number;
  /**
   * Gramos que rinde una hora de campo que empieza en `at` (estación x fertilidad). Sin esto el
   * dormido come de la despensa pero no cosecha: el hogar perdería los brazos de los dormidos.
   */
  readonly harvestPerHour?: (at: Tick) => number;
}

export interface CatchUpResult {
  readonly body: Body;
  readonly happenings: readonly Happening[];
  /** Cuántas comidas hizo y cuántos gramos de la ración (para el asiento del ledger). */
  readonly meals: number;
  readonly grams: number;
  /** Gramos cosechados en las horas de campo del tramo (0 sin `harvestPerHour`). */
  readonly harvest: number;
  /** Horas de campo trabajadas. */
  readonly fieldHours: number;
}

interface HourPlan {
  readonly activity: ReturnType<typeof routineAt>["activity"];
  readonly eats: boolean;
  readonly drinks: boolean;
}

const hourPlan = (hour: number, ageYears: number): HourPlan => ({
  activity: routineAt(hour, ageYears).activity,
  eats: ROUTINE.meals.includes(hour),
  drinks: ROUTINE.meals.includes(hour) || ROUTINE.drinkAlso.includes(hour),
});

/** Comer y beber en la hora (puro): igual que `life.routine`, con la ración de quien llama. */
function intake(
  plan: BodyPlanDef,
  body: Body,
  p: HourPlan,
  ration: CatchUpOptions["ration"],
): { body: Body; grams: number } {
  let next = body;
  let grams = 0;
  if (p.eats) {
    const kcal = MEAL_KCAL * (body.massKg / plan.physiology.refMassKg);
    grams = Math.ceil(kcal / ration.kcalPerGram);
    next = ingest(plan, next, Math.round(grams * ration.kcalPerGram), grams * ration.waterPerGram);
  }
  if (p.drinks) {
    const liters = Math.min(MAX_DRINK_L, Math.max(0, next.water));
    if (liters > 0) next = ingest(plan, next, 0, liters);
  }
  return { body: next, grams };
}

function run(
  plan: BodyPlanDef,
  entity: AgentId,
  body: Body,
  to: Tick,
  o: CatchUpOptions,
  coarse: boolean,
): CatchUpResult {
  const hourSeconds = o.clock.day / 24;
  const happenings: Happening[] = [];
  let b = body;
  let meals = 0;
  let grams = 0;
  let harvest = 0;
  let fieldHours = 0;
  while (b.death === null && b.updatedAt < to) {
    const start = b.updatedAt;
    const hour = Math.floor(localHour(o.clock, start, o.lonDeg));
    const p = hourPlan(hour, o.ageYears);
    // Sin ración que alcance no come (ni se inventa la comida): sigue el agua y el día.
    const eats = p.eats && meals < (o.maxMeals ?? Number.POSITIVE_INFINITY);
    const taken = intake(plan, b, { ...p, eats }, o.ration);
    b = setActivity(taken.body, p.activity);
    if (eats) {
      meals++;
      grams += taken.grams;
    }
    // Cuántas horas más siguen igual: misma actividad y ni comida ni bebida en medio.
    let hours = 1;
    while (coarse && start + (hours + 1) * hourSeconds <= to) {
      const next = hourPlan(
        Math.floor(localHour(o.clock, start + hours * hourSeconds, o.lonDeg)),
        o.ageYears,
      );
      if (next.activity !== p.activity || next.eats || next.drinks) break;
      hours++;
    }
    const end = Math.min(to, (start + hours * hourSeconds) as Tick) as Tick;
    const adv = advanceBody(
      plan,
      entity,
      b,
      end,
      undefined,
      0,
      undefined,
      false,
      coarse ? hours * hourSeconds : undefined,
    );
    b = adv.body;
    happenings.push(...adv.happenings);
    // Las horas de rutina en el campo (`moderate`) rinden como las de `life.routine`, si sigue vivo.
    if (p.activity === "moderate" && b.death === null) {
      fieldHours += hours;
      if (o.harvestPerHour) harvest += hours * o.harvestPerHour(start as Tick);
    }
  }
  return { body: b, happenings, meals, grams, harvest, fieldHours };
}

/** La puesta al día con paso grueso: el atajo. */
export function catchUpRoutine(
  plan: BodyPlanDef,
  entity: AgentId,
  body: Body,
  to: Tick,
  o: CatchUpOptions,
): CatchUpResult {
  return run(plan, entity, body, to, o, true);
}

/** La referencia exacta: hora por hora, como si nadie se hubiera dormido. */
export function catchUpByHour(
  plan: BodyPlanDef,
  entity: AgentId,
  body: Body,
  to: Tick,
  o: CatchUpOptions,
): CatchUpResult {
  return run(plan, entity, body, to, o, false);
}
