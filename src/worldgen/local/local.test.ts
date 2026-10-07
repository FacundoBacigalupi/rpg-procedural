import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { EventLog, loadContent } from "../../core/index.ts";
import { BIOMES, type Biome, Grid, generatePlanet, type Planet } from "../planet/index.ts";
import { localPatch } from "./patch.ts";
import { siteRef, villageSite } from "./site.ts";
import { localTerrain } from "./terrain.ts";

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

const cache = new Map<number, Planet>();
function planet(seed: number): Planet {
  let p = cache.get(seed);
  if (!p) {
    // La frecuencia de verdad: con una grilla gruesa el nivel 1 tendría cientos de miles de hexes.
    p = generatePlanet({ seed, biomes });
    cache.set(seed, p);
  }
  return p;
}

/** Celdas de tierra del planeta, para elegir al azar en las propiedades. */
function landCells(p: Planet): number[] {
  const out: number[] = [];
  for (let c = 0; c < p.grid.size; c++) if ((p.tectonics.elevation[c] as number) > 0) out.push(c);
  return out;
}

describe("red fina", () => {
  it("los vecinos de la red son los de la grilla, también en aristas y esquinas", () => {
    for (const n of [1, 2, 3, 5]) {
      const grid = new Grid(n);
      const lat = grid.lattice;
      for (let f = 0; f < 20; f++) {
        for (let i = 0; i <= n; i++) {
          for (let j = 0; i + j <= n; j++) {
            const id = lat.id(f, i, j);
            const want = [...grid.neighborsOf(id)].sort((a, b) => a - b);
            expect(lat.neighbors(f, i, j)).toEqual(want);
          }
        }
      }
    }
  });
});

describe("parche local", () => {
  it("vecinos simétricos y tantos hexes como entran en la celda", () => {
    const p = planet(3);
    const land = landCells(p);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: land.length - 1 }), (k) => {
        const c = land[k] as number;
        const patch = localPatch(p, c);
        const size = patch.hexes.length;
        for (let h = 0; h < size; h++) {
          for (const m of patch.neighbors[h] as readonly number[]) {
            expect(patch.neighbors[m]).toContain(h);
          }
        }
        // Un hex fino ocupa 1/factor² de una celda (los pentágonos, un poco menos).
        const expected = patch.factor * patch.factor;
        expect(size).toBeGreaterThan(0.8 * expected);
        expect(size).toBeLessThan(1.2 * expected);
      }),
      { numRuns: 8 },
    );
  }, 60_000);
});

describe("terreno local", () => {
  it("respeta los agregados de la celda: altura media, caudal, bosque y esencia", () => {
    const p = planet(2);
    const land = landCells(p);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: land.length - 1 }), (k) => {
        const c = land[k] as number;
        const patch = localPatch(p, c);
        const tr = localTerrain(p, patch);
        const size = patch.hexes.length;
        const mean = tr.elevation.reduce((a, b) => a + b, 0) / size;
        expect(mean).toBeCloseTo(p.tectonics.elevation[c] as number, 6);
        expect(tr.outflow).toBeCloseTo(
          Math.max(
            p.hydrology.discharge[c] as number,
            tr.inflows.reduce((a, x) => a + x[2], 0),
          ),
          6,
        );
        expect(tr.essence.reduce((a, b) => a + b, 0)).toBe(p.essence.level[c]);
        const biome = p.biomes[p.biome[c] as number] as Biome;
        let candidates = 0;
        let forest = 0;
        for (let h = 0; h < size; h++) {
          if (!tr.sea[h] && !tr.lake[h] && (tr.temperature[h] as number) >= -8) candidates++;
          forest += tr.forest[h] as number;
        }
        expect(forest).toBe(Math.round(biome.treeCover * candidates));
        // Todo hex desagua: la cadena termina fuera de la celda, sin ciclos.
        // 0 sin ver, 1 en el camino actual, 2 ya sabido que sale.
        const state = new Uint8Array(size);
        for (let h = 0; h < size; h++) {
          const path: number[] = [];
          let x = h;
          while (x >= 0 && state[x] === 0) {
            state[x] = 1;
            path.push(x);
            x = tr.flowTo[x] as number;
          }
          expect(x < 0 || state[x] === 2).toBe(true);
          for (const y of path) state[y] = 2;
        }
      }),
      { numRuns: 10 },
    );
  }, 60_000);
});

describe("sitio de la aldea", () => {
  it("mismo seed, mismo sitio", () => {
    const a = villageSite(planet(3));
    const b = villageSite(planet(3));
    expect(siteRef(a)).toEqual(siteRef(b));
    expect(a.anchors).toEqual(b.anchors);
    expect(a.forest).toEqual(b.forest);
    expect(a.events).toEqual(b.events);
  }, 60_000);

  it("la aldea tiene agua, campos y causas en el registro", () => {
    for (const seed of [1, 2, 3]) {
      const p = planet(seed);
      const site = villageSite(p);
      const tr = site.terrain;
      expect(tr.sea[site.hex]).toBe(0);
      expect(tr.lake[site.hex]).toBe(0);
      expect(site.anchors.some((a) => a.kind === "water")).toBe(true);
      expect(site.farmland.length).toBeGreaterThan(0);
      for (const h of site.forest) expect(tr.forest[h]).toBe(1);
      const log = EventLog.from(site.events);
      expect(site.events.length).toBe(p.events.length + 2);
      for (const a of site.anchors) expect(log.has(a.cause)).toBe(true);
      const founded = log.get(site.foundedEvent);
      expect(founded?.kind).toBe("settlement.founded");
      const ancestors = log.ancestors(site.foundedEvent);
      expect(ancestors).toContain(p.events[0]?.id); // planet.formed
      if (site.forest.length > 0) expect(ancestors).toContain(site.forestEvent);
    }
  }, 60_000);
});
