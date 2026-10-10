// Nutrientes crónicos cableados a la vida (body-health §5): cada día las reservas de cada persona
// (proteína, vitamina C, yodo, hierro, vitamina D) suman lo que aporta su dieta y gastan lo que el
// cuerpo necesita (`stepStores`). Las reservas viven en `NUTRITION`, aparte del `Body`, y solo se
// guardan mientras alguna está por debajo de lo lleno: con la dieta de la aldea (que cubre la
// necesidad) el proceso no escribe nada. Cuando una carencia sube de etapa (incipiente, franca,
// grave) deja un evento `body.deficiency` con causa. Sin azar. La dieta es la de referencia de
// `content/diets/` hasta que la despensa registre qué se comió de verdad; quien pasa hambre
// (sin glucógeno ni grasa) come una fracción.

import type { AgentId, EntityRef, PlaceRef, PlanetClock } from "../../core/index.ts";
import {
  BODY_NUTRIENTS,
  BODY_STATE,
  DEFICIENCY_EFFECTS,
  type DeficiencyStage,
  type DietDef,
  deficiencyStage,
  dietDayIntake,
  draftEvent,
  ENTITY,
  type EventDraft,
  endEntity,
  fullStores,
  MEALS,
  malnutritionDeath,
  mealIntake,
  NUTRITION,
  type Nutrient,
  type NutrientProfile,
  type NutrientProfileDef,
  type NutrientStores,
  needMultiplier,
  PERSON,
  type ProcessDef,
  type ReadonlyWorldTruth,
  SEVERE_PROTEIN,
  STORE_DAYS,
  type StateChange,
  seriousDeficiencyEffects,
  setComponent,
  severeProteinSince,
  stepStores,
} from "../../sim/index.ts";

export const NUTRITION_PROCESS = "life.nutrition";

/** Fracción de la dieta que come quien no tiene ni glucógeno ni grasa (calibración abierta). */
export const STARVING_INTAKE = 0.2;
/** Máximo de días que se ponen al día de una vez (el resto no cambia el resultado: reservas acotadas). */
const MAX_CATCH_UP_DAYS = 400;
/** Por encima de esta diferencia con lo lleno, una reserva cuenta como no llena. */
const FULL_EPS = 1e-9;

export interface NutritionOptions {
  readonly clock: PlanetClock;
  readonly profiles: readonly NutrientProfileDef[];
  /** La dieta de referencia; sin ella el proceso no hace nada. */
  readonly diet: DietDef | undefined;
  /**
   * Usar lo realmente comido (`MEALS`) en los días con registro y la necesidad por edad y heridas;
   * los días sin registro siguen con la dieta de referencia. Apagado por defecto: la aldea no cambia.
   */
  readonly useEaten?: boolean;
  /**
   * Muerte por desnutrición proteica grave sostenida (`LETHAL_SEVERE_PROTEIN_DAYS`), con causa
   * `malnutrition` y el estado de nutrición como causa. Apagado por defecto: sin muertes nuevas.
   */
  readonly lethal?: boolean;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

/** Los perfiles de nutrientes por alimento, listos para sumar. */
export function profileMap(defs: readonly NutrientProfileDef[]): Map<string, NutrientProfile> {
  return new Map(defs.map((p) => [p.id, p.perKg as NutrientProfile]));
}

const isFull = (s: NutrientStores) => BODY_NUTRIENTS.every((n) => s[n] >= STORE_DAYS[n] - FULL_EPS);

/**
 * Etapas de carencia de alguien para `bodySigns` (opt-in): `undefined` si el opt-in está apagado o
 * no tiene reservas guardadas (dieta llena), así el resultado es el de siempre.
 */
export function deficiencyStagesOf(
  truth: ReadonlyWorldTruth,
  who: EntityRef,
  enabled: boolean | undefined,
): Partial<Record<Nutrient, DeficiencyStage>> | undefined {
  if (!enabled) return undefined;
  const row = truth.get(NUTRITION, who);
  if (!row) return undefined;
  const out: Partial<Record<Nutrient, DeficiencyStage>> = {};
  for (const n of BODY_NUTRIENTS) out[n] = deficiencyStage(row.stores, n);
  return out;
}

const RANK = { none: 0, early: 1, overt: 2, severe: 3 } as const;

export function nutritionProcess(o: NutritionOptions): ProcessDef {
  const profiles = profileMap(o.profiles);
  const intake = o.diet ? dietDayIntake(o.diet, profiles) : undefined;
  return {
    id: NUTRITION_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "settle",
    reads: [PERSON.name, ENTITY.name, BODY_STATE.name, NUTRITION.name, MEALS.name],
    writes: [NUTRITION.name, DEFICIENCY_EFFECTS.name, SEVERE_PROTEIN.name, ENTITY.name],
    run(ctx) {
      if (!intake) return {};
      const changes: StateChange[] = [];
      const events: EventDraft[] = [];
      const days = Math.min(MAX_CATCH_UP_DAYS, Math.max(1, Math.round(ctx.window / o.clock.day)));
      for (const id of ctx.truth.ids(PERSON)) {
        const body = ctx.truth.get(BODY_STATE, id);
        const base = ctx.truth.get(ENTITY, id);
        if (!body || !base || base.endedAt !== undefined || body.death) continue;
        const had = ctx.truth.get(NUTRITION, id);
        const before = had?.stores ?? fullStores();
        const hungry = body.glycogen <= 0 && body.fat <= 0;
        const today = hungry ? scaled(intake, STARVING_INTAKE) : intake;
        let stores = before;
        const meal = o.useEaten ? ctx.truth.get(MEALS, id) : undefined;
        const born = ctx.truth.get(PERSON, id)?.born ?? ctx.now - 30 * o.clock.year;
        const need = o.useEaten
          ? needMultiplier({
              ageYears: (ctx.now - born) / o.clock.year,
              openWounds: body.wounds.filter((w) => w.stage !== "healed").length,
            })
          : 1;
        const lastDay = Math.floor(ctx.now / o.clock.day);
        for (let d = 0; d < days; d++) {
          const eaten = meal && meal.day === lastDay - (days - 1 - d) ? meal : undefined;
          stores = stepStores(stores, eaten ? mealIntake(eaten, profiles) : today, need);
        }
        // Solo las carencias serias (etapa franca o peor) publican efectos.
        const effects = isFull(stores) ? undefined : seriousDeficiencyEffects(stores);
        if (effects) changes.push(setComponent(DEFICIENCY_EFFECTS, id, effects));
        else if (ctx.truth.get(DEFICIENCY_EFFECTS, id))
          changes.push({ op: "delete", table: DEFICIENCY_EFFECTS.name, id });
        if (o.lethal) {
          const prevSevere = ctx.truth.get(SEVERE_PROTEIN, id);
          const since = severeProteinSince(stores, prevSevere, ctx.now);
          if (since === undefined) {
            if (prevSevere) changes.push({ op: "delete", table: SEVERE_PROTEIN.name, id });
          } else if (!prevSevere) changes.push(setComponent(SEVERE_PROTEIN, id, { since }));
          if (malnutritionDeath(since, ctx.now, o.clock.day)) {
            events.push({
              kind: "body.died",
              actors: [id as AgentId],
              place: o.placeOf(ctx.truth, id as AgentId),
              data: {
                cause: "malnutrition",
                days: Math.round((ctx.now - (since ?? ctx.now)) / o.clock.day),
              },
              emissions: { sight: 0.5, sound: 0.1 },
              causes: [{ kind: "state", entity: id as AgentId, key: "body.nutrition" }],
            });
            changes.push(setComponent(NUTRITION, id, { stores, at: ctx.now }));
            changes.push(endEntity(base, draftEvent(events.length - 1), ctx.now));
            continue;
          }
        }
        if (isFull(stores)) {
          if (had) changes.push({ op: "delete", table: NUTRITION.name, id });
          continue;
        }
        changes.push(setComponent(NUTRITION, id, { stores, at: ctx.now }));
        const agent = id as AgentId;
        for (const n of BODY_NUTRIENTS) {
          const was = deficiencyStage(before, n);
          const now = deficiencyStage(stores, n);
          if (RANK[now] <= RANK[was]) continue;
          events.push({
            kind: "body.deficiency",
            actors: [agent],
            place: o.placeOf(ctx.truth, agent),
            data: { nutrient: n, stage: now, days: Math.round(stores[n]) },
            emissions: {},
            causes: [{ kind: "state", entity: agent, key: "body.nutrition" }],
          });
        }
      }
      return changes.length > 0 || events.length > 0 ? { changes, events } : {};
    },
  };
}

function scaled(intake: Readonly<Record<Nutrient, number>>, k: number): Record<Nutrient, number> {
  const out = { ...intake };
  for (const n of BODY_NUTRIENTS) out[n] = intake[n] * k;
  return out;
}
