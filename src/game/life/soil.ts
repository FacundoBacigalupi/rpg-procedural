// El suelo de la aldea día a día (economy §1): lo que salió del campo desde ayer —tomado del
// acumulado de la fuente `harvest` del ledger, así cuenta también lo que cosecha el personaje— le
// saca fertilidad, y el descanso se la devuelve. La rutina rinde `fertilidad × estación`.

import { externalAccount, type PlanetClock } from "../../core/index.ts";
import {
  ENTITY,
  HARVEST,
  HARVEST_GOOD,
  HARVEST_GRAMS_PER_HOUR,
  PERSON,
  type ProcessDef,
  SOIL,
  type SoilState,
  setComponent,
  soilAfter,
} from "../../sim/index.ts";
import { ROUTINE } from "./routine.ts";

export const SOIL_PROCESS = "life.soil";

export interface SoilOptions {
  readonly clock: PlanetClock;
}

export function soilProcess(o: SoilOptions): ProcessDef {
  return {
    id: SOIL_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "settle",
    reads: [SOIL.name, PERSON.name, ENTITY.name],
    writes: [SOIL.name],
    run(ctx) {
      const [id] = ctx.truth.ids(SOIL);
      const soil = id === undefined ? undefined : ctx.truth.get(SOIL, id);
      if (id === undefined || !soil) return {};
      const taken = -(ctx.ledger?.balance(externalAccount(HARVEST), HARVEST_GOOD) ?? -soil.seen);
      const workers = ctx.truth
        .ids(PERSON)
        .filter(
          (p) =>
            ctx.truth.get(ENTITY, p)?.endedAt === undefined &&
            (ctx.now - (ctx.truth.get(PERSON, p)?.born ?? ctx.now)) / o.clock.year >=
              ROUTINE.workAge,
        ).length;
      const days = Math.max(1, ctx.window) / o.clock.day;
      const fullDay = workers * (ROUTINE.work[1] - ROUTINE.work[0]) * HARVEST_GRAMS_PER_HOUR;
      const next: SoilState = {
        fertility: soilAfter(soil.fertility, Math.max(0, taken - soil.seen), fullDay, days),
        seen: Math.max(taken, soil.seen),
      };
      return { changes: [setComponent(SOIL, id, next)] };
    },
  };
}
