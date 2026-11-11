// Parches unidos (novel-sect-seat-patch): el mapa de la aldea con el de otra celda a continuación,
// sin aristas cruzadas y con los índices de la aldea intactos.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadContent } from "../../core/index.ts";
import { hexPath, joinMaps, type LocalMap, patchesOf, patchOf } from "../../sim/index.ts";
import { BIOMES, generatePlanet, ring, villageSite } from "../../worldgen/index.ts";
import { cellMapOf, localMapOf } from "./map.ts";

const biomes = loadContent(
  [BIOMES],
  [
    {
      kind: "biomes",
      file: "content/biomes/whittaker.json",
      data: JSON.parse(readFileSync("content/biomes/whittaker.json", "utf8")),
    },
  ],
).all(BIOMES);

/** Un mapa sintético en línea: `n` hexes, cada uno vecino del siguiente. */
function line(cell: number, n: number, cross = 100): LocalMap {
  return {
    cell: cell as unknown as LocalMap["cell"],
    lonDeg: cell,
    neighbors: Array.from({ length: n }, (_, i) => [i - 1, i + 1].filter((j) => j >= 0 && j < n)),
    crossSeconds: new Array<number>(n).fill(cross),
    forest: new Array<boolean>(n).fill(false),
    elevationM: new Array<number>(n).fill(cell * 10),
    climate: {
      cell: String(cell),
      latDeg: 0,
      axialTiltDeg: 23,
      annualMeanC: cell,
      seasonalRangeC: 10,
      annualPrecipMm: 800,
      windEast: 0,
      windNorth: 0,
    },
  };
}

describe("parches unidos", () => {
  it("los hexes del otro parche van después, sin aristas entre parches", () => {
    const home = line(1, 4);
    const joined = joinMaps(home, [line(2, 3, 50)]);
    expect(joined.neighbors.length).toBe(7);
    expect(joined.neighbors.slice(0, 4)).toEqual(home.neighbors);
    expect(joined.neighbors[4]).toEqual([5]);
    expect(joined.neighbors[6]).toEqual([5]);
    expect(joined.crossSeconds[5]).toBe(50);
    expect(joined.elevationM?.[6]).toBe(20);
    for (const [h, ns] of joined.neighbors.entries()) {
      for (const n of ns) expect(patchOf(joined, n).cell).toBe(patchOf(joined, h).cell);
    }
    expect(hexPath(joined, 0, 5)).toEqual([]);
    expect(hexPath(joined, 4, 6)).toEqual([5, 6]);
    expect(patchesOf(joined).map((p) => [p.cell, p.base, p.size])).toEqual([
      [1, 0, 4],
      [2, 4, 3],
    ]);
    expect(patchOf(joined, 5).climate.annualMeanC).toBe(2);
    expect(joined.climate).toBe(home.climate);
  });

  it("sin otros parches, o con la misma celda, el mapa queda igual", () => {
    const home = line(1, 4);
    expect(joinMaps(home, [])).toBe(home);
    expect(joinMaps(home, [line(1, 9)])).toBe(home);
    expect(patchesOf(home)).toEqual([expect.objectContaining({ cell: 1, base: 0, size: 4 })]);
  });

  it("con un planeta: la celda vecina se une igual en dos corridas y la aldea no cambia", () => {
    const planet = generatePlanet({ seed: 7, biomes });
    const site = villageSite(planet);
    const village = localMapOf(planet, site);
    const [next] = ring(planet.grid, site.patch.cell, 1).filter(([, hops]) => hops === 1)[0] ?? [];
    expect(next).toBeDefined();
    const a = joinMaps(village, [cellMapOf(planet, next as number)]);
    const b = joinMaps(village, [cellMapOf(planet, next as number)]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.neighbors.slice(0, village.neighbors.length)).toEqual(village.neighbors);
    expect(a.crossSeconds.slice(0, village.crossSeconds.length)).toEqual(village.crossSeconds);
    const seat = patchesOf(a)[1];
    expect(seat?.cell).toBe(planet.grid.cellId(next as number));
    expect(seat?.base).toBe(village.neighbors.length);
    expect(a.neighbors.length).toBe((seat?.base ?? 0) + (seat?.size ?? 0));
  });
});
