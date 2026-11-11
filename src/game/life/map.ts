// El `LocalMap` que leen los procesos (sim/world/space), armado desde el sitio de la aldea de
// worldgen: vecinos del parche, la longitud de la celda y cuánto se tarda en cruzar cada hex a pie.

import { type PlanetClock, Rng, type Seed } from "../../core/index.ts";
import { anomalyOfMap, harvestSeason, joinMaps, type LocalMap, subMap } from "../../sim/index.ts";
import {
  type LocalPatch,
  localPatch,
  localTerrain,
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
  site: Pick<VillageSite, "patch" | "terrain">,
  noOscillation: boolean = false,
  noFlood: boolean = false,
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
    water: patch.hexes.map((_, h) =>
      tr.sea[h] || tr.lake[h] ? 3 : tr.water[h] === 2 ? 2 : tr.water[h] === 1 ? 1 : 0,
    ),
    baseElevationM: tr.elevation.reduce((s, e) => s + e, 0) / Math.max(1, patch.hexes.length),
    ...(osc?.basin != null
      ? {
          oscillation: {
            basin: osc.basin,
            teleconnection: osc.teleconnection,
            ...(noFlood ? {} : { flood: true as const }),
          },
        }
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

/**
 * El `LocalMap` de cualquier celda del planeta (novel-sect-seat-patch): el mismo armado que el de
 * la aldea, desde el parche fino y su terreno. Para unirlo al de la aldea, `joinMaps`.
 */
export function cellMapOf(planet: Planet, cell: number): LocalMap {
  const patch = localPatch(planet, cell);
  return localMapOf(planet, { patch, terrain: localTerrain(planet, patch) });
}

/** El camino de celdas más corto de `from` a `to` (BFS sobre la grilla, vecinos en orden). */
export function cellPath(planet: Planet, from: number, to: number): number[] {
  const prev = new Map<number, number>([[from, from]]);
  let frontier = [from];
  while (frontier.length > 0 && !prev.has(to)) {
    const next: number[] = [];
    for (const c of frontier) {
      for (const m of [...planet.grid.neighborsOf(c)].sort((a, b) => a - b)) {
        if (prev.has(m)) continue;
        prev.set(m, c);
        next.push(m);
      }
    }
    frontier = next;
  }
  if (!prev.has(to)) return [from];
  const out: number[] = [];
  for (let c = to; c !== from; c = prev.get(c) as number) out.push(c);
  return [from, ...out.reverse()];
}

/** La franja más corta (en hexes) de un parche entre su borde con `prev` y su borde con `next`. */
function stripOf(patch: LocalPatch, prev: number, next: number): number[] {
  const touches = (c: number) =>
    patch.hexes.map((_, h) => h).filter((h) => (patch.outside[h] ?? []).includes(c));
  const goal = new Set(touches(next));
  const back = new Map<number, number>();
  let frontier = touches(prev);
  for (const h of frontier) back.set(h, h);
  let end = frontier.find((h) => goal.has(h));
  while (end === undefined && frontier.length > 0) {
    const nextFrontier: number[] = [];
    for (const h of frontier) {
      for (const m of patch.neighbors[h] ?? []) {
        if (back.has(m)) continue;
        back.set(m, h);
        nextFrontier.push(m);
        if (end === undefined && goal.has(m)) end = m;
      }
    }
    frontier = nextFrontier;
  }
  if (end === undefined) return [];
  const out = [end];
  for (let h = end; back.get(h) !== h; h = back.get(h) as number) out.push(back.get(h) as number);
  return out.reverse();
}

/**
 * El mapa de la aldea unido, por tierra, con el de otra celda (novel-sect-seat-road): las celdas
 * del camino (`cellPath`) se cosen por los hexes que se tocan en cada borde. La celda de destino
 * entra entera; las de en medio, solo con la franja más corta que las cruza. Si la otra celda es
 * la de la aldea, el mapa es el de la aldea.
 */
export function regionMapOf(
  planet: Planet,
  home: { readonly map: LocalMap; readonly patch: LocalPatch },
  to: number,
): LocalMap {
  const cells = cellPath(planet, home.patch.cell, to);
  if (cells.length < 2) return home.map;
  const parts: { map: LocalMap; ids: number[]; outside: (readonly number[])[] }[] = [];
  for (let i = 1; i < cells.length; i++) {
    const c = cells[i] as number;
    const patch = localPatch(planet, c);
    const full = localMapOf(planet, { patch, terrain: localTerrain(planet, patch) });
    const keep =
      i === cells.length - 1
        ? patch.hexes.map((_, h) => h)
        : stripOf(patch, cells[i - 1] as number, cells[i + 1] as number);
    parts.push({
      map: keep.length === patch.hexes.length ? full : subMap(full, keep),
      ids: keep.map((h) => patch.hexes[h] as number),
      outside: keep.map((h) => patch.outsideHexes[h] ?? []),
    });
  }
  const global = new Map<number, number>(home.patch.hexes.map((id, h) => [id, h]));
  let base = home.map.neighbors.length;
  const links: [number, number][] = [];
  for (const part of parts) {
    part.ids.forEach((id, h) => {
      global.set(id, base + h);
    });
    part.outside.forEach((outs, h) => {
      for (const id of outs) {
        const other = global.get(id);
        if (other !== undefined && other < base) links.push([other, base + h]);
      }
    });
    base += part.map.neighbors.length;
  }
  return joinMaps(
    home.map,
    parts.map((p) => p.map),
    links,
  );
}

/**
 * Lo que rinde cada día del año en la aldea (`harvestSeason`) con el año de la oscilación y, desde
 * `life-35`, con el campo anegado si el mapa lo pide (`oscillation.flood`).
 */
export function harvestSeasonOf(
  map: LocalMap,
  clock: PlanetClock,
  seed: Seed,
): (day: number) => number {
  return harvestSeason(
    map.climate,
    clock,
    Rng.root(seed),
    anomalyOfMap(map, clock, seed),
    map.oscillation?.flood === true,
  );
}
