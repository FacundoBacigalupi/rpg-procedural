import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadContent } from "../../core/index.ts";
import { BIOMES, generatePlanet, oceanBasins, oscillationSite } from "./index.ts";

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

describe("cuencas y teleconexión", () => {
  const p = generatePlanet({ seed: 7, biomes, frequency: 16 });
  const elev = p.tectonics.elevation;
  const basins = oceanBasins(p.grid, elev);

  it("el mar se parte en cuencas y la tierra no tiene", () => {
    expect(basins.keys.length).toBeGreaterThan(0);
    for (let c = 0; c < p.grid.size; c++)
      expect(basins.basinOf[c] === -1).toBe((elev[c] as number) > 0);
    const total = basins.areas.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(0.1);
    expect(total).toBeLessThan(1);
  });

  it("es determinista y acotado", () => {
    const again = oceanBasins(p.grid, elev);
    expect(again.keys).toEqual(basins.keys);
    let coastal = 0;
    for (let c = 0; c < p.grid.size; c += 3) {
      const s = oscillationSite(p.grid, basins, p.kmPerHop, c);
      expect(s).toEqual(oscillationSite(p.grid, basins, p.kmPerHop, c));
      expect(Math.abs(s.teleconnection)).toBeLessThanOrEqual(1);
      if (s.basin === null) expect(s.teleconnection).toBe(0);
      if ((elev[c] as number) > 0 && s.hops === 1 && Math.abs(s.teleconnection) > 0) coastal++;
    }
    expect(coastal).toBeGreaterThan(0);
  });

  it("cae tierra adentro y las dos orillas de una cuenca tienen signo opuesto", () => {
    const signs = new Set<number>();
    const meanAt = new Map<number, { s: number; n: number }>();
    for (let c = 0; c < p.grid.size; c++) {
      if ((elev[c] as number) <= 0) continue;
      const s = oscillationSite(p.grid, basins, p.kmPerHop, c);
      if (s.basin === null || s.teleconnection === 0) continue;
      signs.add(Math.sign(s.teleconnection));
      const m = meanAt.get(s.hops) ?? { s: 0, n: 0 };
      m.s += Math.abs(s.teleconnection);
      m.n++;
      meanAt.set(s.hops, m);
    }
    expect(signs.has(1) && signs.has(-1)).toBe(true);
    const hs = [...meanAt.keys()].sort((a, b) => a - b);
    const first = meanAt.get(hs[0] as number) as { s: number; n: number };
    const last = meanAt.get(hs[hs.length - 1] as number) as { s: number; n: number };
    expect(last.s / last.n).toBeLessThan(first.s / first.n);
  });
});
