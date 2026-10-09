import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { EventLog, loadContent, makeId, Rng } from "../../core/index.ts";
import {
  apportion,
  BIOMES,
  type Biome,
  biomeOrder,
  classifyBiome,
  ESSENCE_SOURCES,
  essenceSources,
  Grid,
  generatePlanet,
  Lattice,
  normalize,
  type Planet,
  pickVillageSite,
  planetDigest,
  regionCell,
} from "./index.ts";

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

const unit = fc
  .tuple(
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true }),
  )
  .filter(([x, y, z]) => x * x + y * y + z * z > 1e-6)
  .map(([x, y, z]) => normalize(x, y, z));

const cache = new Map<string, Planet>();
function planet(seed: number, frequency = 10): Planet {
  const key = `${seed}/${frequency}`;
  let p = cache.get(key);
  if (!p) {
    p = generatePlanet({ seed, biomes, frequency });
    cache.set(key, p);
  }
  return p;
}

describe("grilla Goldberg", () => {
  it("10n²+2 celdas, 12 pentágonos, vecinos simétricos, áreas que suman 1", () => {
    for (const n of [1, 2, 3, 7, 12]) {
      const g = new Grid(n);
      expect(g.size).toBe(10 * n * n + 2);
      let pentagons = 0;
      let area = 0;
      for (let c = 0; c < g.size; c++) {
        const nb = [...g.neighborsOf(c)];
        if (nb.length === 5) pentagons++;
        else expect(nb.length).toBe(6);
        for (const m of nb) expect([...g.neighborsOf(m)]).toContain(c);
        const p = g.at(c);
        expect(Math.abs(p[0] * p[0] + p[1] * p[1] + p[2] * p[2] - 1)).toBeLessThan(1e-15);
        area += g.areas[c] as number;
      }
      expect(pentagons).toBe(12);
      expect(Math.abs(area - 1)).toBeLessThan(1e-12);
    }
  });

  it("los ids canónicos cubren 0..10n²+1 sin huecos y una arista da el mismo punto desde las dos caras", () => {
    for (const n of [2, 5, 9]) {
      const L = new Lattice(n);
      const pos = new Map<number, string>();
      for (let f = 0; f < 20; f++) {
        for (let i = 0; i <= n; i++) {
          for (let j = 0; i + j <= n; j++) {
            const id = L.id(f, i, j);
            const p = JSON.stringify(L.position(f, i, j));
            const before = pos.get(id);
            if (before !== undefined) expect(p).toBe(before);
            pos.set(id, p);
          }
        }
      }
      expect([...pos.keys()].sort((a, b) => a - b)).toEqual(
        Array.from({ length: L.size }, (_, k) => k),
      );
    }
  });

  it("locate da la celda más cercana, empiece donde empiece", () => {
    const g = new Grid(9);
    fc.assert(
      fc.property(unit, fc.nat(g.size - 1), (p, start) => {
        expect(g.locate(p, start)).toBe(g.locateBrute(p));
      }),
      { numRuns: 500 },
    );
  });

  it("el nivel 1 es una partición exacta: cada vértice fino tiene un solo padre, el más cercano", () => {
    for (const [n, k] of [
      [2, 3],
      [3, 4],
      [4, 2],
    ] as const) {
      const g = new Grid(n);
      const fine = new Lattice(n * k);
      const owner = new Map<number, number>();
      for (let c = 0; c < g.size; c++) {
        for (const child of g.refine(c, k)) {
          expect(owner.has(child.id)).toBe(false);
          owner.set(child.id, c);
          expect(g.locateBrute(child.center)).toBe(c);
        }
      }
      expect(owner.size).toBe(fine.size);
    }
  });
});

describe("apportion", () => {
  it("las partes suman exactamente el total y ninguna se aleja más de 1 de su parte justa", () => {
    fc.assert(
      fc.property(
        fc.nat(1_000_000_000_000),
        fc.array(fc.double({ min: 0, max: 1e6, noNaN: true }), { minLength: 1, maxLength: 50 }),
        (total, w) => {
          fc.pre(w.some((x) => x > 0));
          const parts = apportion(total, w);
          expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
          const sum = w.reduce((a, b) => a + b, 0);
          parts.forEach((p, i) => {
            expect(Number.isSafeInteger(p)).toBe(true);
            expect(Math.abs(p - (total * (w[i] as number)) / sum)).toBeLessThan(1 + 1e-6);
            if (w[i] === 0) expect(p).toBe(0);
          });
        },
      ),
    );
  });
});

describe("biomas", () => {
  it("el contenido cubre todo el espacio de temperatura, lluvia y altura", () => {
    const ordered = biomeOrder(biomes);
    for (const where of ["land", "ocean", "lake"] as const) {
      for (let t = -60; t <= 50; t += 2.5) {
        for (let p = 0; p <= 6000; p += 125) {
          for (const e of where === "ocean" ? [-6000, -500] : [10, 2000, 5000]) {
            expect(() =>
              classifyBiome(ordered, { where, temperature: t, precipitation: p, elevation: e }),
            ).not.toThrow();
          }
        }
      }
    }
  });
});

describe("planeta", () => {
  it("mismo seed, mismo planeta; otro seed, otro", () => {
    const a = generatePlanet({ seed: 7, biomes, frequency: 8 });
    const b = generatePlanet({ seed: 7, biomes, frequency: 8 });
    expect(planetDigest(a)).toBe(planetDigest(b));
    expect(planetDigest(generatePlanet({ seed: 8, biomes, frequency: 8 }))).not.toBe(
      planetDigest(a),
    );
  });

  it("hash fijo: si cambia sin querer, cambió la física o el motor (ARCHITECTURE §7.4)", () => {
    // Si el cambio es a propósito (otra física, otro contenido), actualizar el hash.
    expect(planetDigest(planet(1, 6))).toBe(
      "7d4762ff20cac4bd2c96ea5463c1b9260d41c8695b7e31dba91f08fb967c3d21",
    );
  });

  it("las etapas tienen su rama de azar: cambiar la inclinación no mueve la tectónica", () => {
    const a = generatePlanet({ seed: 3, biomes, frequency: 8, cosmology: { axialTiltDeg: 10 } });
    const b = generatePlanet({ seed: 3, biomes, frequency: 8, cosmology: { axialTiltDeg: 35 } });
    expect([...a.tectonics.elevation]).toEqual([...b.tectonics.elevation]);
    expect([...a.climate.temperature]).not.toEqual([...b.climate.temperature]);
  });

  it("rangos sanos sin NaN en muchos seeds", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0x7fffffff }), (seed) => {
        const p = generatePlanet({ seed, biomes, frequency: 7 });
        const t = p.tectonics;
        expect(t.plateCount).toBeGreaterThanOrEqual(8);
        expect(t.plateCount).toBeLessThanOrEqual(20);
        expect(p.cosmology.radiusKm).toBeGreaterThanOrEqual(2 * 6371 - 1);
        expect(p.cosmology.radiusKm).toBeLessThanOrEqual(4 * 6371 + 1);
        // La fracción de tierra por área, con el error de una celda.
        expect(Math.abs(t.landFraction - p.cosmology.landFraction)).toBeLessThan(0.01);
        for (let c = 0; c < p.grid.size; c++) {
          const e = t.elevation[c] as number;
          const T = p.climate.temperature[c] as number;
          const P = p.climate.precipitation[c] as number;
          expect(e).toBeGreaterThan(-12000);
          expect(e).toBeLessThan(12000);
          expect(T).toBeGreaterThan(-90);
          expect(T).toBeLessThan(50);
          expect(P).toBeGreaterThanOrEqual(0);
          expect(P).toBeLessThan(20000);
          expect(Number.isFinite(p.habitability[c] as number)).toBe(true);
          expect(Number.isFinite(p.climate.seasonalRange[c] as number)).toBe(true);
          expect(Number.isFinite(p.hydrology.discharge[c] as number)).toBe(true);
          expect(Number.isFinite(t.mineralization[c] as number)).toBe(true);
        }
      }),
      { numRuns: 40 },
    );
  });

  it("calibración: la lluvia en tierra es parecida a la de la Tierra y los interiores no son todo desierto", () => {
    // Medido a 175 km por celda (8 seeds, 2026-10-08): media en tierra 500-640 mm, 23-32 % bajo 100 mm.
    for (const seed of [1, 2, 3]) {
      const p = generatePlanet({ seed, biomes, spacingKm: 175 });
      let n = 0;
      let sum = 0;
      let arid = 0;
      for (let c = 0; c < p.grid.size; c++) {
        if ((p.tectonics.elevation[c] as number) <= 0) continue;
        const P = p.climate.precipitation[c] as number;
        n++;
        sum += P;
        if (P < 100) arid++;
      }
      expect(sum / n).toBeGreaterThan(350);
      expect(sum / n).toBeLessThan(900);
      expect(arid / n).toBeLessThan(0.4);
    }
  }, 600_000);

  it("calibración: el mar es la cuenca grande y los mares sin salida son lagos", () => {
    // Antes había ~100 componentes de mar por seed (4-28 % de las celdas de océano); ahora las
    // cuencas bajo el nivel del mar menores al 10 % de la mayor son lagos endorreicos.
    for (const seed of [1, 2, 3]) {
      const p = generatePlanet({ seed, biomes, spacingKm: 175 });
      const e = p.tectonics.elevation;
      const sea = (c: number) => (e[c] as number) <= 0 && !p.hydrology.lake[c];
      const seen = new Uint8Array(p.grid.size);
      const sizes: number[] = [];
      let inland = 0;
      for (let c = 0; c < p.grid.size; c++) {
        if ((e[c] as number) <= 0 && p.hydrology.lake[c]) inland++;
        if (seen[c] || !sea(c)) continue;
        const cells = [c];
        seen[c] = 1;
        for (let i = 0; i < cells.length; i++) {
          for (const m of p.grid.neighborsOf(cells[i] as number)) {
            if (seen[m] || !sea(m)) continue;
            seen[m] = 1;
            cells.push(m);
          }
        }
        sizes.push(cells.length);
      }
      const biggest = Math.max(...sizes);
      for (const s of sizes) expect(s).toBeGreaterThanOrEqual(0.1 * biggest);
      expect(inland).toBeGreaterThan(0);
    }
  }, 600_000);

  it("todo río baja hasta el mar sin ciclos", () => {
    for (const seed of [1, 2, 3]) {
      const p = planet(seed, 16);
      const { flowTo, river } = p.hydrology;
      let rivers = 0;
      for (let c = 0; c < p.grid.size; c++) {
        if ((p.tectonics.elevation[c] as number) <= 0) {
          expect(flowTo[c]).toBe(-1);
          continue;
        }
        if (river[c]) rivers++;
        let x = c;
        let steps = 0;
        while ((p.tectonics.elevation[x] as number) > 0) {
          const next = flowTo[x] as number;
          expect(p.grid.neighborsOf(x)).toContain(next);
          x = next;
          expect(++steps).toBeLessThan(p.grid.size);
        }
      }
      expect(rivers).toBeGreaterThan(0);
    }
  });

  it("la esencia suma exactamente el presupuesto, por celda y por fuente", () => {
    const p = planet(2, 12);
    const e = p.essence;
    let total = 0;
    let regen = 0;
    for (let c = 0; c < p.grid.size; c++) {
      const l = e.level[c] as number;
      expect(Number.isSafeInteger(l)).toBe(true);
      total += l;
      regen += e.regen[c] as number;
      let parts = 0;
      for (const k of e.byKind) parts += k[c] as number;
      expect(parts).toBe(l);
      expect(e.capacity[c]).toBeGreaterThanOrEqual(l);
    }
    expect(total).toBe(p.cosmology.essenceBudget);
    expect(regen).toBe(Math.floor(p.cosmology.essenceBudget / 100));
  });

  it("toda fuente de esencia tiene una causa en el registro, y el registro es válido", () => {
    const p = planet(4, 12);
    const log = EventLog.from(p.events);
    const kinds = new Set<string>();
    for (let c = 0; c < p.grid.size; c++) {
      for (const s of essenceSources(p.essence, c)) {
        expect(log.has(s.cause)).toBe(true);
        kinds.add(s.kind);
      }
      if (p.tectonics.volcanic[c]) {
        const v = makeId("event", p.tectonics.volcanoEvent[c] as number);
        expect(log.get(v)?.kind).toBe("planet.volcano");
        expect(log.ancestors(v)).toContain(makeId("event", 1)); // planet.formed
      }
    }
    for (const k of ESSENCE_SOURCES) expect(kinds).toContain(k);
  });

  it("el nivel 1 conserva lo de su padre", () => {
    const p = planet(5, 6);
    const c = 17;
    const parent = p.essence.level[c] as number;
    const children = p.grid.refine(c, 8);
    // Pesos de las hijas: cualquiera (después saldrán del relieve fino); acá, la cercanía al centro.
    const center = p.grid.at(c);
    const w = children.map(
      (ch) => 1 + ch.center[0] * center[0] + ch.center[1] * center[1] + ch.center[2] * center[2],
    );
    expect(apportion(parent, w).reduce((a, b) => a + b, 0)).toBe(parent);
    expect(children.length).toBeGreaterThan(40);
  });

  it("la aldea va a una celda de tierra habitable, siempre la misma para el mismo seed", () => {
    const p = planet(6, 16);
    const a = pickVillageSite(p, Rng.root(6).fork("village"));
    const b = pickVillageSite(p, Rng.root(6).fork("village"));
    expect(a).toBe(b);
    const cell = regionCell(p, a);
    expect(cell.elevation).toBeGreaterThan(0);
    expect(cell.habitability).toBeGreaterThan(0.3);
    expect(cell.id).toBe(p.grid.cellId(a));
    expect(biomes.map((x: Biome) => x.id)).toContain(cell.biome);
  });
});
