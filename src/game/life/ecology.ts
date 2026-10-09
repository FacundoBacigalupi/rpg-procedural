// La ecología de la celda de la aldea día a día (living-world §8, §9): la producción primaria sale
// del tiempo del día y del suelo de los campos, las poblaciones corren la red trófica (la caza de la
// gente va aparte, contra `harvestStock`) y el monte avanza su sucesión de a un año. Cada día deja
// además el peligro de incendio; la chispa que lo vuelve fuego es de un ítem aparte.

import type { PlanetClock, Seed } from "../../core/index.ts";
import {
  advanceSuccession,
  dailyProductivity,
  ECOLOGY,
  fireHazard,
  type LineageDef,
  type LocalMap,
  lineageOf,
  type ProcessDef,
  SOIL,
  setComponent,
  type TrajectoryDef,
  trophicStep,
  weatherAt,
} from "../../sim/index.ts";

export const ECOLOGY_PROCESS = "life.ecology";

/** Eventos de chispa esperados por día en el monte (rayo y fogatas sueltas); calibrar con el fuego real. */
export const BASE_SPARK = 0.002;

export interface EcologyOptions {
  readonly clock: PlanetClock;
  readonly map: LocalMap;
  readonly seed: Seed;
  readonly lineages: readonly LineageDef[];
  readonly trajectories: readonly TrajectoryDef[];
}

/** Cuántos hexes del mapa local cuenta la celda ecológica de la aldea (su zona de caza y monte). */
export function ecologyHexes(map: LocalMap): number {
  return Math.max(1, Math.min(37, map.forest.length));
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

export function ecologyProcess(o: EcologyOptions): ProcessDef {
  const lineages = Object.fromEntries(o.lineages.map((d) => [d.id, lineageOf(d)]));
  return {
    id: ECOLOGY_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "settle",
    reads: [ECOLOGY.name, SOIL.name],
    writes: [ECOLOGY.name],
    run(ctx) {
      const [id] = ctx.truth.ids(ECOLOGY);
      const eco = id === undefined ? undefined : ctx.truth.get(ECOLOGY, id);
      if (id === undefined || !eco) return {};
      const days = Math.max(1, ctx.window) / o.clock.day;
      const weather = weatherAt(o.map, o.clock, o.seed, ctx.now);
      const soil = id === undefined ? undefined : ctx.truth.get(SOIL, id);
      const hexes = ecologyHexes(o.map);
      const productivity = dailyProductivity({
        tempMeanC: weather.tempMeanC,
        annualPrecipMm: o.map.climate.annualPrecipMm,
        soilFertility: soil?.fertility ?? 1,
        hexes,
      });
      // Pasos de <= 5 días (estabilidad de la integración); un tramo largo se topa en 60 pasos.
      const steps = Math.min(60, Math.max(1, Math.ceil(days / 5)));
      let cell = { ...eco.cell, productivity };
      for (let i = 0; i < steps; i++) cell = trophicStep(cell, lineages, days / steps).next;
      let forest = eco.forest;
      let yearDays = eco.yearDays + days;
      const years = Math.floor(yearDays / 365);
      if (years > 0) {
        yearDays -= years * 365;
        forest = advanceSuccession(forest, { vigor: 1, seedSource: 1, soilDepth: 1 }, years);
      }
      const dryness = weather.precip.kind === "none" ? clamp01(weather.tempMeanC / 30) : 0;
      return {
        changes: [
          setComponent(ECOLOGY, id, {
            cell,
            forest,
            fireHazard: fireHazard(forest, dryness, BASE_SPARK),
            day: eco.day + days,
            yearDays,
          }),
        ],
      };
    },
  };
}
