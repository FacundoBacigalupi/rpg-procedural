// Ecología de una celda viva (living-world §8, §9): los linajes salen de `content/lineages`, la
// producción primaria sale del clima del día y del suelo, y la celda lleva sus poblaciones (red
// trófica de `trophic.ts`) y el monte (sucesión y combustible de `succession.ts`). Puro: sin RNG ni IO.

import { contentId, defineContent, exp, z } from "../../core/index.ts";
import { type ReadonlyWorldTruth, table } from "../world/index.ts";
import type { PatchVegetation, SuccessionStage, Trajectory } from "./succession.ts";
import type { CellEcology, Lineage } from "./trophic.ts";

export const LineageDef = z.strictObject({
  id: contentId,
  name: z.string().min(1),
  kingdom: z.enum(["plant", "herbivore", "carnivore"]),
  growth: z.number().min(0),
  mortality: z.number().min(0),
  bodyMass: z.number().positive(),
  diet: z.record(contentId, z.number().min(0).max(1)).optional(),
  maxIntake: z.number().min(0),
  halfSaturation: z.number().positive(),
  efficiency: z.number().min(0).max(1),
  /** Dónde vive: media anual (°C) y lluvia mínima (mm/año). Fuera de ahí no arranca en la celda. */
  habitat: z.strictObject({
    minC: z.number(),
    maxC: z.number(),
    minMm: z.number().min(0),
  }),
  /** Individuos por km² de celda con productividad media al arrancar (la celda lo escala por su comida). */
  density: z.number().min(0),
});
export type LineageDef = z.infer<typeof LineageDef>;
export const LINEAGES = defineContent("lineages", LineageDef, (l) =>
  Object.keys(l.diet ?? {}).map((to) => ({ kind: "lineages", id: to, at: `diet.${to}` })),
);

export const TrajectoryDef = z.strictObject({
  id: contentId,
  climax: z.enum(["bare", "pioneer", "grass_shrub", "young_forest", "mature_forest", "old_growth"]),
  years: z.record(
    z.enum(["bare", "pioneer", "grass_shrub", "young_forest", "mature_forest", "old_growth"]),
    z.number().positive(),
  ),
  /** Lluvia anual (mm) desde la que el bioma llega a esta trayectoria. */
  minMm: z.number().min(0),
});
export type TrajectoryDef = z.infer<typeof TrajectoryDef>;
export const TRAJECTORIES = defineContent("trajectories", TrajectoryDef);

/** Estado ecológico de la celda de la aldea, en la entidad de la aldea. */
export interface EcologyState {
  readonly cell: CellEcology;
  readonly forest: PatchVegetation;
  /** Peligro de incendio del último día (0-1): la chispa lo vuelve fuego. */
  readonly fireHazard: number;
  /** Último día simulado. */
  readonly day: number;
  /** Días acumulados hacia el próximo año de sucesión. */
  readonly yearDays: number;
}

export const ECOLOGY = table<EcologyState>("living.ecology");

/** Área de un hex local (~2 km de lado a lado), m². */
export const HEX_AREA_M2 = 3.46e6;
/** Fracción de la producción primaria que llega a la cadena (el resto es leña, tronco, raíz). */
export const FORAGE_SHARE = 0.05;
/** Biomasa vegetal máxima por m² y día (kg) con calor, agua y suelo plenos. */
export const NPP_PEAK = 0.004;

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** Producción primaria del día (kg de biomasa que entra a la cadena) de una celda de `hexes` hexes. */
export function dailyProductivity(o: {
  readonly tempMeanC: number;
  readonly annualPrecipMm: number;
  readonly soilFertility: number;
  readonly hexes: number;
}): number {
  const warm = clamp01(o.tempMeanC / 20);
  const water = 1 - exp(-o.annualPrecipMm / 1000);
  return NPP_PEAK * HEX_AREA_M2 * o.hexes * warm * water * clamp01(o.soilFertility) * FORAGE_SHARE;
}

export function lineageOf(def: LineageDef): Lineage {
  return {
    id: def.id,
    kingdom: def.kingdom,
    growth: def.growth,
    mortality: def.mortality,
    bodyMass: def.bodyMass,
    ...(def.diet ? { diet: def.diet } : {}),
    maxIntake: def.maxIntake,
    halfSaturation: def.halfSaturation,
    efficiency: def.efficiency,
  };
}

/** Poblaciones iniciales: los linajes que viven con ese clima, por la comida media de la celda. */
export function initialCell(
  defs: readonly LineageDef[],
  o: {
    readonly annualMeanC: number;
    readonly annualPrecipMm: number;
    readonly hexes: number;
    readonly shelter: number;
    readonly productivity: number;
  },
): CellEcology {
  const km2 = (o.hexes * HEX_AREA_M2) / 1e6;
  const populations = defs
    .filter(
      (d) =>
        d.kingdom !== "plant" &&
        o.annualMeanC >= d.habitat.minC &&
        o.annualMeanC <= d.habitat.maxC &&
        o.annualPrecipMm >= d.habitat.minMm,
    )
    .map((d) => ({ lineage: d.id, count: d.density * km2 }));
  return { productivity: o.productivity, shelter: clamp01(o.shelter), populations };
}

/** La trayectoria de vegetación que corresponde a la lluvia anual (la de más agua que alcanza). */
export function pickTrajectory(
  defs: readonly TrajectoryDef[],
  annualPrecipMm: number,
): Trajectory | undefined {
  const fit = defs
    .filter((t) => annualPrecipMm >= t.minMm)
    .sort((a, b) => b.minMm - a.minMm || a.id.localeCompare(b.id))[0];
  if (!fit) return undefined;
  return {
    id: fit.id,
    climax: fit.climax,
    years: fit.years as Readonly<Record<SuccessionStage, number>>,
  };
}

/** La ecología de la aldea, si está anotada. */
export function villageEcology(truth: ReadonlyWorldTruth): EcologyState | undefined {
  const [id] = truth.ids(ECOLOGY);
  return id === undefined ? undefined : truth.get(ECOLOGY, id);
}
