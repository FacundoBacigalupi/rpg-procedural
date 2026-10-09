// La rutina de la gente de la aldea (player-loop §5, npc-psychology §utilidad todavía no): hasta
// que los NPC decidan con su utilidad (Fase 2), cada hora siguen el día de la aldea. Duermen de
// noche en su casa, trabajan de día en el campo desde los diez años, comen tres veces de la
// despensa del hogar (con su evento y su asiento: la comida no aparece) y beben lo que les falta.
// Es el mismo cuerpo y la misma despensa que usa el personaje; él no tiene rutina: decide.
//
// Moverse entre la casa y el campo es instantáneo a la hora en punto: el viaje corto de la aldea
// queda debajo de la resolución local (simulation §LOD). Cuando haya `decide` de verdad, esto se
// vuelve la rutina por defecto de un plan (actions §3), no un proceso aparte.

import {
  type AgentId,
  externalAccount,
  type HolderRef,
  holderAccount,
  type LedgerUnit,
  ledgerUnit,
  type PlaceRef,
  type PlanetClock,
  Rng,
  type Seed,
} from "../../core/index.ts";
import {
  type Activity,
  BODY_STATE,
  type BodyPlanDef,
  BUILDING,
  dayOf,
  draftEvent,
  EATEN,
  ENTITY,
  type EventDraft,
  type FoodDef,
  fieldFertility,
  HARVEST,
  HARVEST_GOOD,
  HARVEST_GRAMS_PER_HOUR,
  harvestSeason,
  houseKey,
  ingest,
  LOCATION,
  type LocalMap,
  type Location,
  localHour,
  MEAL_KCAL,
  nearestHex,
  needsFrom,
  PERSON,
  PLACE,
  type ProcessDef,
  type ReadonlyWorldTruth,
  SOIL,
  type SpaceGraph,
  type StateChange,
  setActivity,
  setComponent,
  VILLAGE_SQUARE,
} from "../../sim/index.ts";
import { PLAN_STATE } from "./act.ts";
import { type Decision, NPC_DECISION } from "./decide.ts";
import { PLAYER } from "./player.ts";

export const ROUTINE_PROCESS = "life.routine";

/** Las horas locales del día de la aldea. */
export const ROUTINE = {
  /** Se acuestan a esta hora y se levantan a la otra. */
  sleep: 21,
  wake: 5,
  meals: [7, 12, 19] as readonly number[],
  /** Una vuelta al pozo a media tarde. */
  drinkAlso: [15] as readonly number[],
  work: [8, 18] as const,
  /** Desde qué edad se va al campo. */
  workAge: 10,
} as const;

/** Desde cuánta necesidad de descanso o dolor se queda en casa en vez de ir al campo. */
const UNWELL_REST = 0.85;
const UNWELL_PAIN = 0.5;
/** Días de comida del hogar por debajo de los cuales no se saltea la cosecha. */
const LARDER_LOW_DAYS = 14;
/** Desde cuánta hambre una decisión fresca de comer saca una ración fuera de las comidas. */
const EAT_HUNGER = 0.6;

/** Lo que se bebe de una vez, como mucho: lo que falta, hasta esto. */
const MAX_DRINK_L = 1.5;

export interface RoutineOptions {
  readonly map: LocalMap;
  readonly spaces: SpaceGraph;
  readonly bodyPlans: readonly BodyPlanDef[];
  readonly foods: readonly FoodDef[];
  readonly clock: PlanetClock;
  readonly seed: Seed;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

/** Qué hace a esta hora quien sigue la rutina: dónde y con qué esfuerzo. */
export function routineAt(
  hour: number,
  ageYears: number,
): { activity: Activity; at: "home" | "fields" } {
  const h = Math.floor(hour);
  if (h >= ROUTINE.sleep || h < ROUTINE.wake) return { activity: "sleep", at: "home" };
  if (ageYears >= ROUTINE.workAge && h >= ROUTINE.work[0] && h < ROUTINE.work[1]) {
    return { activity: "moderate", at: "fields" };
  }
  return { activity: ageYears < 3 ? "rest" : "light", at: "home" };
}

/**
 * La rutina como plantilla de plan por defecto (actions §3): `routineAt` es lo que hace quien no
 * decidió otra cosa, y la decisión vigente (`life.decision`, de hoy) la reemplaza cuando gana otra
 * candidata. Por ahora solo reemplaza el tramo de trabajo: quien elige descansar (`rest`) se queda
 * en casa en vez de ir al campo, y solo si de verdad está agotado o dolorido (`unwell`) y la
 * despensa del hogar no está baja (`larderLow`: la cosecha no se saltea con hambre en casa); al
 * descansar se recupera y deja de cumplirse, así que no encadena días. De noche manda el sueño y el resto de la decisión (comer, beber,
 * hablar, ayudar) todavía no mueve el cuerpo.
 */
export function planFor(
  hour: number,
  ageYears: number,
  decision: Pick<Decision, "verb" | "at"> | undefined,
  now: number,
  day: number,
  state: {
    readonly unwell: boolean;
    readonly larderLow: boolean;
    readonly hungry?: boolean;
  } = {
    unwell: false,
    larderLow: false,
  },
): { activity: Activity; at: "home" | "fields"; replaced: boolean; eat?: true } {
  const base = routineAt(hour, ageYears);
  const fresh = decision !== undefined && now - decision.at < day;
  // Comer decidido: una ración fuera de las comidas de la rutina (que ya comen a su hora, así
  // que no se duplica), despierto y con hambre; al comer el hambre baja y no encadena.
  if (
    fresh &&
    decision.verb === "eat" &&
    state.hungry === true &&
    base.activity !== "sleep" &&
    !ROUTINE.meals.includes(Math.floor(hour))
  ) {
    return { ...base, replaced: true, eat: true };
  }
  if (
    fresh &&
    decision.verb === "rest" &&
    base.at === "fields" &&
    state.unwell &&
    !state.larderLow
  ) {
    return { activity: "rest", at: "home", replaced: true };
  }
  return { ...base, replaced: false };
}

export function routineProcess(o: RoutineOptions): ProcessDef {
  const plans = new Map(o.bodyPlans.map((p) => [p.id, p]));
  const foods = o.foods
    .filter((f) => f.kcalPerGram > 0)
    .map((f) => ({ unit: ledgerUnit(`good:${f.id}`), food: f }));
  // El rinde de la hora depende del día del año (calor, helada, lluvia reciente).
  const season = harvestSeason(o.map.climate, o.clock, Rng.root(o.seed));
  const nutrition = new Map<LedgerUnit, FoodDef>(foods.map((f) => [f.unit, f.food]));

  return {
    id: ROUTINE_PROCESS,
    system: "life",
    scope: "agent",
    cadence: { local: "hour", scene: "hour" },
    representation: "individual",
    phase: "act",
    reads: [
      PLAYER.name,
      PLAN_STATE.name,
      NPC_DECISION.name,
      SOIL.name,
      ENTITY.name,
      PERSON.name,
      LOCATION.name,
      BODY_STATE.name,
    ],
    writes: [LOCATION.name, BODY_STATE.name],
    run(ctx) {
      const me = ctx.scope as AgentId;
      const truth = ctx.truth;
      // El personaje decide él; quien tiene un plan en curso lo sigue.
      if (truth.has(PLAYER, me)) return {};
      const plan = truth.get(PLAN_STATE, me);
      if (plan && !plan.done) return {};
      const person = truth.get(PERSON, me);
      const body = truth.get(BODY_STATE, me);
      if (!person || !body || truth.get(ENTITY, me)?.endedAt !== undefined) return {};
      if (body.death || body.consciousness === "unconscious") return {};
      const bodyPlan = plans.get(body.plan);
      if (!bodyPlan) throw new RangeError(`plan corporal desconocido: ${body.plan}`);

      const hour = Math.floor(localHour(o.clock, ctx.now, o.map.lonDeg));
      const age = (ctx.now - person.born) / o.clock.year;
      const needs = needsFrom(bodyPlan, body);
      const unwell = (needs.rest ?? 0) >= UNWELL_REST || (needs.pain ?? 0) >= UNWELL_PAIN;
      let larderLow = false;
      if (unwell) {
        const mouths = truth
          .ids(PERSON)
          .filter(
            (id) =>
              truth.get(PERSON, id)?.household === person.household &&
              truth.get(ENTITY, id)?.endedAt === undefined,
          ).length;
        const kcal = (
          ctx.ledger?.holdings(holderAccount(person.household as unknown as HolderRef)) ?? []
        ).reduce((t, h) => t + h.amount * (nutrition.get(h.unit)?.kcalPerGram ?? 0), 0);
        larderLow = kcal < LARDER_LOW_DAYS * 3 * MEAL_KCAL * Math.max(1, mouths);
      }
      const want = planFor(hour, age, truth.get(NPC_DECISION, me), ctx.now, o.clock.day, {
        unwell,
        larderLow,
        hungry: (needs.hunger ?? 0) >= EAT_HUNGER,
      });
      const changes: StateChange[] = [];
      const events: EventDraft[] = [];
      const postings = [];

      // Dónde: la casa del hogar o el campo más cercano a ella.
      const home = o.spaces.spaces.find((s) => s.key === houseKey(person.household));
      const here = truth.get(LOCATION, me);
      let there: Location | undefined;
      if (want.at === "home" && home) there = { hex: home.hex, space: home.key };
      if (want.at === "fields" && home) {
        const fields = truth.ids(PLACE).flatMap((id) => {
          const p = truth.get(PLACE, id);
          return p?.kind === "fields" ? [...p.hexes] : [];
        });
        if (fields.length > 0) there = { hex: nearestHex(o.map, home.hex, fields) };
      }
      // La puerta trabada del hogar no cede: de afuera no se entra (queda en la plaza) y de
      // adentro no se sale hasta que la arreglen (settlements �7).
      if (home && jammedHome(truth, person.household)) {
        const inside = o.spaces.spaces.find((s) => s.key === here?.space)?.indoor === true;
        const toHome = there?.space === home.key;
        if (!inside && toHome) there = { hex: home.hex, space: VILLAGE_SQUARE };
        else if (inside && !toHome) there = undefined;
      }
      if (there && (here?.hex !== there.hex || here?.space !== there.space)) {
        changes.push(setComponent(LOCATION, me, there));
      }

      let next = setActivity(body, want.activity);
      // Trabajar la tierra rinde: una hora de campo es grano para la despensa del hogar (fuente
      // externa `harvest`; economy §1), según la estación del día: en invierno o con helada el
      // campo no da y la hora no deja asiento.
      const day = dayOf(o.clock, ctx.now + Math.round((o.map.lonDeg / 360) * o.clock.day));
      const grams = Math.round(HARVEST_GRAMS_PER_HOUR * season(day) * fieldFertility(truth));
      if (want.at === "fields" && there && grams > 0) {
        const ev = draftEvent(events.length);
        events.push({
          kind: "routine.harvested",
          actors: [me],
          place: o.placeOf(truth, me),
          data: { good: HARVEST_GOOD, grams },
          emissions: { sight: 0.3, sound: 0.1 },
          causes: [{ kind: "state", entity: me, key: "routine" }],
        });
        postings.push({
          event: ev,
          transfers: [
            {
              from: externalAccount(HARVEST),
              to: holderAccount(person.household as unknown as HolderRef),
              unit: HARVEST_GOOD,
              amount: grams,
            },
          ],
        });
      }
      // Comer: una ración a la medida del cuerpo, de lo que haya en la despensa del hogar. Solo
      // si alcanza para todos los de la casa: dos que comen en la misma fase no pueden dejar el
      // saldo en negativo (scheduler, asientos por fase).
      if (ROUTINE.meals.includes(hour) || want.eat) {
        const larder = person.household as unknown as HolderRef;
        const mouths = truth
          .ids(PERSON)
          .filter(
            (id) =>
              truth.get(PERSON, id)?.household === person.household &&
              truth.get(ENTITY, id)?.endedAt === undefined,
          ).length;
        const kcal = MEAL_KCAL * (body.massKg / bodyPlan.physiology.refMassKg);
        const held = (ctx.ledger?.holdings(holderAccount(larder)) ?? [])
          .filter((h) => nutrition.has(h.unit))
          .sort((a, b) => b.amount - a.amount || (a.unit < b.unit ? -1 : 1));
        const row = held.find((h) => {
          const f = nutrition.get(h.unit) as FoodDef;
          return h.amount >= Math.ceil(kcal / f.kcalPerGram) * Math.max(1, mouths);
        });
        if (row) {
          const f = nutrition.get(row.unit) as FoodDef;
          const grams = Math.ceil(kcal / f.kcalPerGram);
          const ev = draftEvent(events.length);
          events.push({
            kind: "routine.ate",
            actors: [me],
            place: o.placeOf(truth, me),
            data: { good: row.unit, grams, ...(want.eat ? { decided: true } : {}) },
            emissions: { sight: 0.2, sound: 0.05 },
            causes: [{ kind: "state", entity: me, key: "routine" }],
          });
          postings.push({
            event: ev,
            transfers: [
              {
                from: holderAccount(larder),
                to: externalAccount(EATEN),
                unit: row.unit,
                amount: grams,
              },
            ],
          });
          next = ingest(bodyPlan, next, Math.round(grams * f.kcalPerGram), grams * f.waterPerGram);
        }
      }
      // Beber lo que falta (el agua del pozo no va al ledger todavía, como en `drink`).
      if (ROUTINE.meals.includes(hour) || ROUTINE.drinkAlso.includes(hour)) {
        const liters = Math.min(MAX_DRINK_L, Math.max(0, next.water));
        if (liters > 0) next = ingest(bodyPlan, next, 0, liters);
      }
      if (next !== body) changes.push(setComponent(BODY_STATE, me, next));
      return { changes, events, postings };
    },
  };
}

/** Si la puerta de la casa del hogar est� trabada. */
function jammedHome(truth: ReadonlyWorldTruth, household: unknown): boolean {
  return truth.ids(BUILDING).some((id) => {
    const b = truth.get(BUILDING, id);
    return b?.household === household && b?.doorState === "jammed";
  });
}
