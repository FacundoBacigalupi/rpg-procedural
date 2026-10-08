// Las presiones de la aldea (causality §9). Por ahora una: el hambre de cada hogar, que sale de
// cuántos días de comida quedan en su despensa para las bocas que tiene. Es una función pura del
// estado; nada se guarda. Las descargas las declara cada proceso que existe: hoy pedir fiado a un
// vecino (borrow.ts); migrar, robar y saquear entran cuando existan esos procesos.

import {
  type HolderRef,
  holderAccount,
  type LedgerUnit,
  ledgerUnit,
  type Tick,
} from "../../core/index.ts";
import {
  type FoodDef,
  HOUSEHOLD,
  MEAL_KCAL,
  PERSON,
  type Pressure,
  type PressureCurve,
  type PressureReading,
  type PressureSource,
  type ReadonlyLedger,
  type ReadonlyWorldTruth,
  readPressures,
  withHazards,
} from "../../sim/index.ts";
import { living } from "./living.ts";

/** Con más días de comida que esto, la despensa no preocupa. */
export const HUNGER_HORIZON_DAYS = 90;

/** El proceso que descarga el hambre pidiendo fiado (ver borrow.ts). */
export const BORROW_PROCESS = "life.borrow";
/** Desde dónde el hambre empieza a empujar a pedir (coincide con la curva de content/pressures). */
export const BORROW_THRESHOLD = 0.6;

const MEALS_PER_DAY = 3;

export function householdHungerSource(foods: readonly FoodDef[]): PressureSource {
  const kcal = new Map<LedgerUnit, number>(
    foods.map((f) => [ledgerUnit(`good:${f.id}`), f.kcalPerGram]),
  );
  return {
    kind: "hunger",
    read({ truth, ledger }): PressureReading[] {
      const mouths = new Map<string, number>();
      for (const id of living(truth)) {
        const h = truth.get(PERSON, id)?.household;
        if (h) mouths.set(h, (mouths.get(h) ?? 0) + 1);
      }
      return truth.ids(HOUSEHOLD).flatMap((id): PressureReading[] => {
        const n = mouths.get(id) ?? 0;
        if (n === 0) return [];
        const stored = ledger
          .holdings(holderAccount(id as unknown as HolderRef))
          .reduce((sum, h) => sum + h.amount * (kcal.get(h.unit) ?? 0), 0);
        const days = stored / (MEALS_PER_DAY * MEAL_KCAL * n);
        return [
          {
            kind: "hunger",
            scope: { kind: "household", ref: id },
            value: Math.min(1, Math.max(0, 1 - days / HUNGER_HORIZON_DAYS)),
            sources: [{ kind: "state", entity: id, key: "larder" }],
            discharges: [
              { process: BORROW_PROCESS, threshold: BORROW_THRESHOLD, hazard: 0, blockers: [] },
            ],
            system: "economy",
          },
        ];
      });
    },
  };
}

/** Lo que hace falta del mundo de la vida para leer sus presiones (sin depender de world.ts). */
export interface PressureWorld {
  readonly truth: ReadonlyWorldTruth;
  readonly ledger: ReadonlyLedger;
  readonly foods: readonly FoodDef[];
  readonly pressureCurves: readonly PressureCurve[];
  readonly scheduler: { readonly now: Tick };
}

export function lifePressures(w: PressureWorld): Pressure[] {
  return withHazards(
    readPressures([householdHungerSource(w.foods)], {
      truth: w.truth,
      ledger: w.ledger,
      now: w.scheduler.now,
    }),
    w.pressureCurves,
    { truth: w.truth, now: w.scheduler.now },
  );
}
