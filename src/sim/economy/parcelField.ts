// El suelo de los campos de la aldea con `parcel.ts` por dentro (planet-gen §9, nivel 1): un
// `ParcelSoil` agregado de los campos de la aldea que el proceso diario mueve (cosecha, barbecho,
// clima) y del que sale la fertilidad que usa la rutina (`parcelYield`). Puro: estado y días adentro,
// estado nuevo afuera. La fertilidad de `soil.ts` queda como la lectura derivada que ve el resto.

import { type ReadonlyWorldTruth, table } from "../world/index.ts";
import {
  afterHarvest,
  afterManure,
  afterWeather,
  type CropSpec,
  fallowDays,
  type ParcelSoil,
  parcelYield,
  type WeatherWear,
} from "./parcel.ts";

export interface ParcelFieldState {
  readonly soil: ParcelSoil;
  /** Gramos cosechados ya contados (igual que `SoilState.seen`). */
  readonly seen: number;
}

/** El suelo por dentro de los campos de la aldea, en la entidad de la aldea. */
export const PARCEL_SOIL = table<ParcelFieldState>("economy.parcel_soil");

// Calibración abierta a la pasada de calibración (ROADMAP Hito 1c).
/** Lo que da el grano de la aldea: la cosecha de siempre vacía ~0,00018 de N por día de carga plena. */
export const GRAIN_CROP: CropSpec = {
  uptake: { n: 0.00018, p: 0.0001, k: 0.0001 },
  saltTolerance: 0.5,
};
/** Fracción de la compactación de `afterHarvest` que cuenta en un paso diario. */
export const DAILY_COMPACTION = 0.02;
/** Lluvia diaria (mm) desde la que cuenta como fuerte para el lavado y la erosión. */
export const HEAVY_RAIN_MM = 20;
/** Pendiente y cobertura medias de los campos de la aldea (hasta que cada parcela tenga las suyas). */
export const FIELD_SLOPE = 0.15;
export const FIELD_COVER = 0.6;

/** Suelo de arranque que rinde `fertility` (loam profundo con los tres nutrientes parejos). */
export function startingParcel(fertility: number): ParcelSoil {
  return {
    texture: "loam",
    depth: 60,
    organic: 0.8,
    fertility: { n: fertility, p: fertility, k: fertility },
    salinity: 0,
    compaction: 0,
  };
}

/** El desgaste del clima de un tramo, desde los días de lluvia fuerte contados. */
export function fieldWear(heavyRainDays: number, arid: boolean): WeatherWear {
  return {
    heavyRainDays,
    slope: FIELD_SLOPE,
    cover: FIELD_COVER,
    irrigatedDays: 0,
    drained: true,
    arid,
  };
}

/**
 * Un tramo de `days` días: salió `load` (0-1 por día, 1 = todos los brazos a pleno) de cosecha,
 * llovió fuerte `heavyRainDays` días y `manure` unidades de abono (calidad `manureQuality`) cayeron.
 */
export function stepParcelField(
  soil: ParcelSoil,
  o: {
    readonly days: number;
    readonly load: number;
    readonly heavyRainDays: number;
    readonly arid: boolean;
    readonly manure?: number;
    readonly manureQuality?: number;
  },
): ParcelSoil {
  if (o.days <= 0) return soil;
  // Un puesto largo (la puesta al día de dormidos) se parte en pasos de ~1 día: la cosecha topa en 1 por paso.
  const steps = Math.min(60, Math.max(1, Math.ceil(o.days)));
  const d = o.days / steps;
  let s = soil;
  for (let i = 0; i < steps; i++) {
    s = fallowDays(s, d);
    const harvested = afterHarvest(s, GRAIN_CROP, Math.max(0, o.load) * d);
    // `afterHarvest` compacta pensando en una cosecha por temporada; acá es diaria y se escala.
    s = {
      ...harvested,
      compaction: s.compaction + (harvested.compaction - s.compaction) * DAILY_COMPACTION,
    };
    if (o.manure && o.manure > 0) s = afterManure(s, o.manure / steps, o.manureQuality ?? 0.5);
    s = afterWeather(s, fieldWear(o.heavyRainDays / steps, o.arid));
  }
  return s;
}

/** Rendimiento 0-1 del campo agregado para el grano. */
export function fieldYield(soil: ParcelSoil): number {
  return parcelYield(soil, GRAIN_CROP);
}

/** El nutriente que más falta, o `undefined` si el campo está sano: lo que el campesino nota como "cansado". */
export function tiredNutrient(soil: ParcelSoil, threshold = 0.6): "n" | "p" | "k" | undefined {
  const { n, p, k } = soil.fertility;
  const min = Math.min(n, p, k);
  if (min >= threshold) return undefined;
  return min === n ? "n" : min === p ? "p" : "k";
}

/** El suelo por dentro de la aldea, si está anotado. */
export function fieldParcel(truth: ReadonlyWorldTruth): ParcelFieldState | undefined {
  const [id] = truth.ids(PARCEL_SOIL);
  return id === undefined ? undefined : truth.get(PARCEL_SOIL, id);
}
