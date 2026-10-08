// El pipeline de planet-gen (planet-gen §2): cosmología → tectónica → clima → hidrología → biomas →
// esencia → habitabilidad. Cada etapa tiene su rama del RNG (`fork`), así cambiar una no corre las
// tiradas de las otras. Mismo seed y mismo contenido dan el mismo planeta bit a bit.

import {
  type CellId,
  canonicalJson,
  type Event,
  makeId,
  PI,
  type Random,
  Rng,
  type Seed,
  sha256Hex,
} from "../../core/index.ts";
import { type Biome, biomeOrder, classifyBiome } from "./biomes.ts";
import { type Climate, climate } from "./climate.ts";
import { type Essence, type EssenceSource, essence, essenceSources } from "./essence.ts";
import { because, PlanetEvents } from "./events.ts";
import { frequencyFor, Grid, type Vec3 } from "./grid.ts";
import { type Hydrology, hydrology } from "./hydrology.ts";
import { BOUNDARY_KINDS, type Rock, rockOf, type Tectonics, tectonics } from "./tectonics.ts";

export const EARTH_RADIUS_KM = 6371;

/** Etapa 0 (planet-gen §2): lo que fija todo lo demás. */
export interface Cosmology {
  readonly radiusKm: number;
  /** En g terrestres. */
  readonly gravity: number;
  readonly axialTiltDeg: number;
  readonly dayHours: number;
  /** Fracción de la superficie sobre el nivel del mar. */
  readonly landFraction: number;
  /** Esencia total del planeta, entero (se conserva). */
  readonly essenceBudget: number;
}

export function rollCosmology(rng: Random): Cosmology {
  const ratio = 2 + 2 * rng.float(); // 2-4 radios terrestres (planet-gen §2)
  return {
    radiusKm: Math.round(EARTH_RADIUS_KM * ratio),
    // Menos denso que la Tierra: la gravedad crece menos que el radio.
    gravity: Math.round((0.9 + 0.25 * (ratio - 1) + 0.1 * rng.float()) * 100) / 100,
    axialTiltDeg: Math.round((8 + 32 * rng.float()) * 10) / 10,
    dayHours: Math.round((16 + 24 * rng.float()) * 10) / 10,
    landFraction: Math.round((0.3 + 0.4 * rng.float()) * 1000) / 1000,
    essenceBudget: 1_000_000_000_000,
  };
}

export interface PlanetOptions {
  readonly seed: Seed;
  readonly biomes: readonly Biome[];
  /** Lo que se fija a mano; el resto sale del seed. */
  readonly cosmology?: Partial<Cosmology> | undefined;
  /** Frecuencia de la grilla; si falta, la que da celdas de `spacingKm`. */
  readonly frequency?: number | undefined;
  /** Tamaño buscado de las celdas del nivel 0 (planet-gen §1: 150-200 km). */
  readonly spacingKm?: number | undefined;
}

export interface Planet {
  readonly seed: Seed;
  readonly cosmology: Cosmology;
  readonly grid: Grid;
  /** Distancia media entre centros vecinos. */
  readonly kmPerHop: number;
  readonly events: readonly Event[];
  readonly tectonics: Tectonics;
  readonly climate: Climate;
  readonly hydrology: Hydrology;
  /** Índice en `biomes`. */
  readonly biome: Uint16Array;
  readonly biomes: readonly Biome[];
  readonly essence: Essence;
  /** Para mortales sin técnica [0, 1] (planet-gen §5c). */
  readonly habitability: Float64Array;
}

export function generatePlanet(opts: PlanetOptions): Planet {
  const root = Rng.root(opts.seed).fork("worldgen", "planet");
  const cosmology: Cosmology = { ...rollCosmology(root.fork("cosmology")), ...opts.cosmology };
  const n = opts.frequency ?? frequencyFor(cosmology.radiusKm, opts.spacingKm ?? 175);
  const grid = new Grid(n);
  const kmPerHop = (1.1071487177940904 * cosmology.radiusKm) / n;
  const noise = root.fork("noise");
  const ev = new PlanetEvents();
  const world = { kind: "plane", plane: makeId("plane", 1) } as const;
  const formed = ev.add("planet.formed", world, [{ kind: "seed" }], { cosmology });

  const tect = tectonics(
    grid,
    root.fork("tectonics").stream(),
    { landFraction: cosmology.landFraction, kmPerHop, noiseSeed: noise.u32() },
    ev,
    formed,
  );
  const settled = ev.add("planet.climate_settled", world, because(formed), {
    axialTiltDeg: cosmology.axialTiltDeg,
  });
  const cl = climate(grid, tect.elevation, {
    axialTiltDeg: cosmology.axialTiltDeg,
    kmPerHop,
    noiseSeed: noise.u32(),
  });
  const drained = ev.add("planet.drainage_formed", world, because(settled));
  const hy = hydrology(grid, tect.elevation, cl.precipitation, cl.temperature, cosmology.radiusKm);

  const ordered = biomeOrder(opts.biomes);
  const index = new Map(ordered.map((b, i) => [b.id, i]));
  const biome = new Uint16Array(grid.size);
  for (let c = 0; c < grid.size; c++) {
    const e = tect.elevation[c] as number;
    const where = hy.lake[c] ? "lake" : e <= 0 ? "ocean" : "land";
    const b = classifyBiome(ordered, {
      where,
      temperature: cl.temperature[c] as number,
      precipitation: cl.precipitation[c] as number,
      elevation: e,
    });
    biome[c] = index.get(b.id) as number;
  }

  const ess = essence({
    grid,
    tectonics: tect,
    climate: cl,
    hydrology: hy,
    biome,
    biomes: ordered,
    budget: cosmology.essenceBudget,
    kmPerHop,
    climateEvent: settled,
    hydrologyEvent: drained,
  });

  const habitability = new Float64Array(grid.size);
  for (let c = 0; c < grid.size; c++) {
    const e = tect.elevation[c] as number;
    if (e <= 0 || hy.lake[c]) continue;
    const b = ordered[biome[c] as number] as Biome;
    let coast = false;
    for (const m of grid.neighborsOf(c))
      if ((tect.elevation[m] as number) <= 0 || hy.lake[m]) coast = true;
    const P = cl.precipitation[c] as number;
    const water = hy.river[c] || coast ? 1 : Math.min(1, Math.max(0.1, P / 800));
    const dt = ((cl.temperature[c] as number) - 16) / 22;
    const warmth = Math.max(0, 1 - dt * dt);
    const height = Math.min(1, Math.max(0, 1 - Math.max(0, e - 1500) / 2500));
    habitability[c] = b.habitability * water * warmth * height;
  }

  return {
    seed: opts.seed,
    cosmology,
    grid,
    kmPerHop,
    events: ev.list,
    tectonics: tect,
    climate: cl,
    hydrology: hy,
    biome,
    biomes: ordered,
    essence: ess,
    habitability,
  };
}

/** Dónde poner la aldea inicial (planet-gen §5c): entre las celdas más habitables, al azar. */
export function pickVillageSite(planet: Planet, rng: Random): number {
  const h = planet.habitability;
  let max = 0;
  for (let c = 0; c < h.length; c++) max = Math.max(max, h[c] as number);
  if (!(max > 0)) throw new RangeError("ninguna celda habitable");
  const weights = Array.from(h, (v) => (v >= 0.6 * max ? v * v * v * v : 0));
  return rng.weighted(weights);
}

/** La celda como la describe planet-gen §1, armada desde los arreglos. */
export interface RegionCell {
  readonly id: CellId;
  readonly neighbors: readonly CellId[];
  readonly center: Vec3;
  readonly latDeg: number;
  readonly lonDeg: number;
  /** km². */
  readonly areaKm2: number;
  readonly plate: number;
  readonly crust: "continental" | "oceanic";
  readonly elevation: number;
  readonly rock: Rock;
  readonly temperature: { readonly mean: number; readonly seasonalRange: number };
  readonly precipitation: number;
  readonly river?: { readonly discharge: number; readonly flowsTo: CellId } | undefined;
  readonly lake?: { readonly depth: number } | undefined;
  readonly biome: string;
  readonly essence: {
    readonly level: number;
    readonly capacity: number;
    readonly regen: number;
    readonly sources: readonly { kind: EssenceSource; intensity: number; cause: string }[];
  };
  readonly features: readonly string[];
  readonly habitability: number;
  /** La celda la formó su placa. */
  readonly originEventId: string;
}

export function regionCell(planet: Planet, c: number): RegionCell {
  const { grid, tectonics: t, climate: cl, hydrology: hy, essence: es } = planet;
  const deg = 180 / PI;
  const features: string[] = [];
  if (t.volcanic[c]) features.push("volcano");
  if (hy.river[c]) features.push("river");
  if (hy.lake[c]) features.push("lake");
  if ((t.boundaryKm[c] as number) === 0)
    features.push(`fault:${BOUNDARY_KINDS[t.boundary[c] as number]}`);
  if ((t.elevation[c] as number) > 0) {
    if (grid.neighborsOf(c).some((m) => (t.elevation[m] as number) <= 0)) features.push("coast");
    if ((t.elevation[c] as number) > 3500) features.push("peak");
  }
  if (cl.current[c] === 1) features.push("warm-current");
  if (cl.current[c] === -1) features.push("cold-current");
  const to = hy.flowTo[c] as number;
  return {
    id: grid.cellId(c),
    neighbors: Array.from(grid.neighborsOf(c), (m) => grid.cellId(m)),
    center: grid.at(c),
    latDeg: (grid.lat[c] as number) * deg,
    lonDeg: (grid.lon[c] as number) * deg,
    areaKm2:
      (grid.areas[c] as number) * 4 * PI * planet.cosmology.radiusKm * planet.cosmology.radiusKm,
    plate: t.plate[c] as number,
    crust: t.continental[c] ? "continental" : "oceanic",
    elevation: t.elevation[c] as number,
    rock: rockOf(t, c),
    temperature: {
      mean: cl.temperature[c] as number,
      seasonalRange: cl.seasonalRange[c] as number,
    },
    precipitation: cl.precipitation[c] as number,
    river:
      hy.river[c] && to >= 0
        ? { discharge: hy.discharge[c] as number, flowsTo: grid.cellId(to) }
        : undefined,
    lake: hy.lake[c] ? { depth: hy.lakeDepth[c] as number } : undefined,
    biome: (planet.biomes[planet.biome[c] as number] as Biome).id,
    essence: {
      level: es.level[c] as number,
      capacity: es.capacity[c] as number,
      regen: es.regen[c] as number,
      sources: essenceSources(es, c),
    },
    features,
    habitability: planet.habitability[c] as number,
    originEventId: t.plateEvents[t.plate[c] as number] as string,
  };
}

/** Hash de todas las capas y los eventos: el criterio del test de determinismo. */
export function planetDigest(planet: Planet): string {
  const t = planet.tectonics;
  const cl = planet.climate;
  const hy = planet.hydrology;
  const es = planet.essence;
  const layers: ArrayLike<number>[] = [
    planet.grid.centers,
    planet.grid.areas,
    t.plate,
    t.elevation,
    t.rock,
    t.volcanic,
    t.mineralization,
    cl.temperature,
    cl.seasonalRange,
    cl.precipitation,
    hy.flowTo,
    hy.discharge,
    planet.biome,
    es.level,
    es.capacity,
    es.regen,
    ...es.byKind,
    planet.habitability,
  ];
  let total = 0;
  for (const l of layers) total += l.length;
  const bytes = new Uint8Array(total * 8);
  const view = new DataView(bytes.buffer);
  let o = 0;
  for (const l of layers) {
    for (let i = 0; i < l.length; i++) {
      view.setFloat64(o, l[i] as number, true);
      o += 8;
    }
  }
  return sha256Hex(
    sha256Hex(bytes) + canonicalJson({ cosmology: planet.cosmology, events: planet.events }),
  );
}
