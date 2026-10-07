// Las presiones de la aldea (causality §9). Por ahora una: el hambre de cada hogar, que sale de
// cuántos días de comida quedan en su despensa para las bocas que tiene. Es una función pura del
// estado; nada se guarda. Las descargas (migrar, pedir fiado, robar, saquear) las declara cada
// proceso cuando exista (Hito 1b), y entonces aparecen en `discharges`.

import { type HolderRef, holderAccount, type LedgerUnit, ledgerUnit } from "../../core/index.ts";
import {
  type FoodDef,
  HOUSEHOLD,
  MEAL_KCAL,
  PERSON,
  type Pressure,
  type PressureReading,
  type PressureSource,
  readPressures,
  withHazards,
} from "../../sim/index.ts";
import { type LifeWorld, living } from "./world.ts";

/** Con más días de comida que esto, la despensa no preocupa. */
export const HUNGER_HORIZON_DAYS = 90;

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
            discharges: [],
            system: "economy",
          },
        ];
      });
    },
  };
}

export function lifePressures(w: LifeWorld): Pressure[] {
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
