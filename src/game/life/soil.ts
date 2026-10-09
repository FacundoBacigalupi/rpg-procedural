// El suelo de la aldea día a día (economy §1): lo que salió del campo desde ayer —tomado del
// acumulado de la fuente `harvest` del ledger, así cuenta también lo que cosecha el personaje— le
// saca fertilidad, y el descanso se la devuelve. La rutina rinde `fertilidad × estación`.

import { externalAccount, type PlanetClock, type Seed } from "../../core/index.ts";
import {
  ENTITY,
  fieldYield,
  HARVEST,
  HARVEST_GOOD,
  HARVEST_GRAMS_PER_HOUR,
  HEAVY_RAIN_MM,
  type LocalMap,
  PARCEL_SOIL,
  PERSON,
  type ProcessDef,
  SOIL,
  SOIL_FLOOR,
  setComponent,
  soilAfter,
  startingParcel,
  stepParcelField,
  weatherAt,
} from "../../sim/index.ts";
import { ROUTINE } from "./routine.ts";

export const SOIL_PROCESS = "life.soil";

export interface SoilOptions {
  readonly clock: PlanetClock;
  readonly map: LocalMap;
  readonly seed: Seed;
}

export function soilProcess(o: SoilOptions): ProcessDef {
  return {
    id: SOIL_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "settle",
    reads: [SOIL.name, PARCEL_SOIL.name, PERSON.name, ENTITY.name],
    writes: [SOIL.name, PARCEL_SOIL.name],
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
      const seen = Math.max(taken, soil.seen);
      const parcel = ctx.truth.get(PARCEL_SOIL, id);
      if (!parcel) {
        // Vidas anteriores al suelo por parcela: se sigue con el suelo único y se anota el de adentro.
        const fertility = soilAfter(soil.fertility, Math.max(0, taken - soil.seen), fullDay, days);
        return {
          changes: [
            setComponent(SOIL, id, { fertility, seen }),
            setComponent(PARCEL_SOIL, id, { soil: startingParcel(fertility), seen }),
          ],
        };
      }
      // La carga del tramo es la fracción de un día pleno que se cosechó (la misma cuenta de siempre).
      const load = fullDay > 0 ? Math.max(0, taken - soil.seen) / (fullDay * days) : 0;
      // Clima del tramo: se muestrean hasta 30 días y se escala (lluvia fuerte lava y erosiona).
      const samples = Math.min(30, Math.max(1, Math.round(days)));
      let heavy = 0;
      for (let i = 0; i < samples; i++) {
        const t = ctx.now - Math.round(((i + 0.5) / samples) * days * o.clock.day);
        if (weatherAt(o.map, o.clock, o.seed, t).precip.mm >= HEAVY_RAIN_MM) heavy++;
      }
      const arid = o.map.climate.annualPrecipMm < 400;
      const stepped = stepParcelField(parcel.soil, {
        days,
        load,
        heavyRainDays: (heavy / samples) * days,
        arid,
      });
      const fertility = Math.max(SOIL_FLOOR, Math.min(1, fieldYield(stepped)));
      return {
        changes: [
          setComponent(PARCEL_SOIL, id, { soil: stepped, seen }),
          setComponent(SOIL, id, { fertility, seen }),
        ],
      };
    },
  };
}
