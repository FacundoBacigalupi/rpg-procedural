// Secuelas permanentes del hambre infantil (body-health §5): cada día, a cada niño con una carencia
// seria publicada (`DEFICIENCY_EFFECTS`) se le suma lo que frenó su crecimiento (`stepSequelae`).
// Viven en `GROWTH_SEQUELAE`, tabla aparte con este proceso como único escritor; sin carencia no se
// escribe nada (aldea por defecto: ninguna fila). Sin azar. `heightFactor` lo lee `seedBodies` al
// construir el cuerpo adulto y `cognitionFactor` queda disponible para la mente.

import type { PlanetClock } from "../../core/index.ts";
import {
  DEFICIENCY_EFFECTS,
  ENTITY,
  GROWTH_SEQUELAE,
  NO_SEQUELAE,
  PERSON,
  type ProcessDef,
  type StateChange,
  setComponent,
  stepSequelae,
} from "../../sim/index.ts";

export const GROWTH_SEQUELAE_PROCESS = "life.growth-sequelae";

/** Máximo de días que se ponen al día de una vez. */
const MAX_CATCH_UP_DAYS = 400;

export interface GrowthSequelaeOptions {
  readonly clock: PlanetClock;
}

export function growthSequelaeProcess(o: GrowthSequelaeOptions): ProcessDef {
  return {
    id: GROWTH_SEQUELAE_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "settle",
    reads: [PERSON.name, ENTITY.name, DEFICIENCY_EFFECTS.name, GROWTH_SEQUELAE.name],
    writes: [GROWTH_SEQUELAE.name],
    run(ctx) {
      const changes: StateChange[] = [];
      const days = Math.min(MAX_CATCH_UP_DAYS, Math.max(1, Math.round(ctx.window / o.clock.day)));
      for (const id of ctx.truth.ids(DEFICIENCY_EFFECTS)) {
        const effects = ctx.truth.get(DEFICIENCY_EFFECTS, id);
        const person = ctx.truth.get(PERSON, id);
        const base = ctx.truth.get(ENTITY, id);
        if (!effects || !person || !base || base.endedAt !== undefined) continue;
        const age = (ctx.now - person.born) / o.clock.year;
        const prev = ctx.truth.get(GROWTH_SEQUELAE, id) ?? NO_SEQUELAE;
        const next = stepSequelae(prev, age, effects, days);
        if (next !== prev) changes.push(setComponent(GROWTH_SEQUELAE, id, next));
      }
      return changes.length > 0 ? { changes } : {};
    },
  };
}
