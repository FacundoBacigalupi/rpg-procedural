// El `LocalMap` que leen los procesos (sim/world/space), armado desde el sitio de la aldea de
// worldgen: vecinos del parche, la longitud de la celda y cuánto se tarda en cruzar cada hex a pie.

import type { LocalMap } from "../../sim/index.ts";
import {
  oceanBasins,
  oscillationSite,
  type Planet,
  type VillageSite,
} from "../../worldgen/index.ts";

/** Paso medio a pie sobre llano, m/s. */
export const WALK_SPEED = 1.3;

/** Multiplicadores del tiempo de cruce por terreno (travel §2; calibración abierta). */
const FOREST_FACTOR = 1.6;
const STREAM_FACTOR = 1.3;
const RIVER_FACTOR = 5;
const WATER_FACTOR = 40;
const SLOPE_FACTOR = 8;

/**
 * `noOscillation`: replay de motores anteriores a `life-29`, sin cuenca ni anomalía por año. Si no
 * hay mar al alcance de la celda tampoco se guarda nada.
 */
export function localMapOf(
  planet: Planet,
  site: VillageSite,
  noOscillation: boolean = false,
): LocalMap {
  const osc = noOscillation
    ? undefined
    : oscillationSite(
        planet.grid,
        oceanBasins(planet.grid, planet.tectonics.elevation),
        planet.kmPerHop,
        site.patch.cell,
      );
  const { patch, terrain: tr } = site;
  const km = patch.kmPerHex;
  const crossSeconds = patch.hexes.map((_, h) => {
    let f = 1 + Math.min(2, SLOPE_FACTOR * (tr.slope[h] as number));
    if (tr.forest[h]) f *= FOREST_FACTOR;
    if (tr.sea[h] || tr.lake[h]) f *= WATER_FACTOR;
    else if (tr.water[h] === 2) f *= RIVER_FACTOR;
    else if (tr.water[h] === 1) f *= STREAM_FACTOR;
    return Math.round(((km * 1000) / WALK_SPEED) * f);
  });
  return {
    cell: planet.grid.cellId(patch.cell),
    lonDeg: ((planet.grid.lon[patch.cell] as number) * 180) / Math.PI,
    neighbors: patch.neighbors,
    crossSeconds,
    forest: patch.hexes.map((_, h) => tr.forest[h] === 1),
    elevationM: patch.hexes.map((_, h) => tr.elevation[h] as number),
    baseElevationM: tr.elevation.reduce((s, e) => s + e, 0) / Math.max(1, patch.hexes.length),
    ...(osc?.basin != null
      ? { oscillation: { basin: osc.basin, teleconnection: osc.teleconnection } }
      : {}),
    climate: {
      cell: String(planet.grid.cellId(patch.cell)),
      latDeg: ((planet.grid.lat[patch.cell] as number) * 180) / Math.PI,
      axialTiltDeg: planet.cosmology.axialTiltDeg,
      annualMeanC: planet.climate.temperature[patch.cell] as number,
      seasonalRangeC: planet.climate.seasonalRange[patch.cell] as number,
      annualPrecipMm: planet.climate.precipitation[patch.cell] as number,
      windEast: planet.climate.windEast[patch.cell] as number,
      windNorth: planet.climate.windNorth[patch.cell] as number,
    },
  };
}
