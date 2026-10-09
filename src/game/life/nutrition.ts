// Nutrientes crónicos cableados a la vida (body-health §5): cada día las reservas de cada persona
// (proteína, vitamina C, yodo, hierro, vitamina D) suman lo que aporta su dieta y gastan lo que el
// cuerpo necesita (`stepStores`). Las reservas viven en `NUTRITION`, aparte del `Body`, y solo se
// guardan mientras alguna está por debajo de lo lleno: con la dieta de la aldea (que cubre la
// necesidad) el proceso no escribe nada. Cuando una carencia sube de etapa (incipiente, franca,
// grave) deja un evento `body.deficiency` con causa. Sin azar. La dieta es la de referencia de
// `content/diets/` hasta que la despensa registre qué se comió de verdad; quien pasa hambre
// (sin glucógeno ni grasa) come una fracción.

import type { AgentId, PlaceRef, PlanetClock } from "../../core/index.ts";
import {
  BODY_NUTRIENTS,
  BODY_STATE,
  type DietDef,
  deficiencyStage,
  dietDayIntake,
  ENTITY,
  type EventDraft,
  fullStores,
  NUTRITION,
  type Nutrient,
  type NutrientProfile,
  type NutrientProfileDef,
  type NutrientStores,
  PERSON,
  type ProcessDef,
  type ReadonlyWorldTruth,
  STORE_DAYS,
  type StateChange,
  setComponent,
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
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

/** Los perfiles de nutrientes por alimento, listos para sumar. */
export function profileMap(defs: readonly NutrientProfileDef[]): Map<string, NutrientProfile> {
  return new Map(defs.map((p) => [p.id, p.perKg as NutrientProfile]));
}

const isFull = (s: NutrientStores) => BODY_NUTRIENTS.every((n) => s[n] >= STORE_DAYS[n] - FULL_EPS);

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
    reads: [PERSON.name, ENTITY.name, BODY_STATE.name, NUTRITION.name],
    writes: [NUTRITION.name],
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
        for (let d = 0; d < days; d++) stores = stepStores(stores, today);
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
