// Crecer hasta la talla adulta (body-health §5): `massKg` se fijaba solo al sembrar, así que un chico
// quedaba con la masa de su edad de entonces para siempre. Este proceso diario, al cumplir 18, lleva
// la masa a la que le toca por su genética y la talla que le dejó el hambre infantil
// (`GROWTH_SEQUELAE` -> `heightFactor`); las reservas (glucógeno y grasa) se escalan con la masa para
// no regalar ni quitar comida. Sin azar ni eventos; solo toca `massKg` y las reservas, y es
// idempotente (con la masa ya al día no escribe nada), así que la aldea por defecto, que no lo
// activa, no cambia.

import type { PlanetClock } from "../../core/index.ts";
import {
  BODY_STATE,
  type BodyPlanDef,
  ENTITY,
  GROWTH_SEQUELAE,
  heightFactor,
  INNATE,
  massOf,
  NO_SEQUELAE,
  PERSON,
  type ProcessDef,
  type StateChange,
  setComponent,
  type Trait,
} from "../../sim/index.ts";

export const ADULT_GROWTH_PROCESS = "life.adult-growth";

/** Años desde los que el cuerpo ya está hecho. */
export const ADULT_AGE_YEARS = 18;

/** Diferencia mínima de masa (kg) para reescribir el cuerpo. */
const EPSILON_KG = 0.01;

export interface AdultGrowthOptions {
  readonly clock: PlanetClock;
  readonly plans: readonly BodyPlanDef[];
  readonly traits: readonly Trait[];
  /** Opt-in: los menores de 18 crecen un paso por año cumplido (sin azar); apagado: solo desde los 18. */
  readonly gradual?: boolean;
}

export function adultGrowthProcess(o: AdultGrowthOptions): ProcessDef {
  return {
    id: ADULT_GROWTH_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "settle",
    reads: [PERSON.name, ENTITY.name, INNATE.name, GROWTH_SEQUELAE.name, BODY_STATE.name],
    writes: [BODY_STATE.name],
    run(ctx) {
      const changes: StateChange[] = [];
      for (const id of ctx.truth.ids(PERSON)) {
        const body = ctx.truth.get(BODY_STATE, id);
        const person = ctx.truth.get(PERSON, id);
        const innate = ctx.truth.get(INNATE, id);
        const base = ctx.truth.get(ENTITY, id);
        if (!body || !person || !innate || !base || base.endedAt !== undefined || body.death)
          continue;
        const rawAge = (ctx.now - person.born) / o.clock.year;
        if (rawAge < ADULT_AGE_YEARS && o.gradual !== true) continue;
        const age = rawAge < ADULT_AGE_YEARS ? Math.floor(rawAge) : rawAge;
        const plan = o.plans.find((p) => p.id === body.plan);
        if (!plan) continue;
        const scale = heightFactor(ctx.truth.get(GROWTH_SEQUELAE, id) ?? NO_SEQUELAE);
        const target = massOf(plan, innate, o.traits, person.sex, age, scale);
        if (Math.abs(target - body.massKg) < EPSILON_KG) continue;
        const ratio = body.massKg > 0 ? target / body.massKg : 1;
        changes.push(
          setComponent(BODY_STATE, id, {
            ...body,
            massKg: target,
            glycogen: body.glycogen * ratio,
            fat: body.fat * ratio,
          }),
        );
      }
      return changes.length > 0 ? { changes } : {};
    },
  };
}
