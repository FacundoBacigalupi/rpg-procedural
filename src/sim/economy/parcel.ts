// Suelo por parcela (planet-gen §9, nivel 1): nutrientes abstractos que se mueven (suelo -> cosecha ->
// quien la come -> campo o río), agotamiento por cultivo, barbecho, abono, rotación con leguminosas y
// la degradación lenta (erosión, sal, compactación). Puro: recibe estado y días, devuelve estado nuevo.
// La aldea lo usa agregado en `parcelField.ts` (el proceso diario de suelo); falta una parcela por campo real.

import { pow } from "../../core/index.ts";

/** Nutrientes abstractos por familia (los nombres reales van en `content/`). */
export type NutrientId = "n" | "p" | "k";
export const NUTRIENTS: readonly NutrientId[] = ["n", "p", "k"];

export type Texture = "sand" | "loam" | "clay" | "silt" | "peat" | "ash" | "rocky";

export interface ParcelSoil {
  readonly texture: Texture;
  /** Centímetros de suelo útil: la erosión se lo lleva y no vuelve en una vida. */
  readonly depth: number;
  /** Materia orgánica 0-1: sostiene la retención de nutrientes y se quema con el arado. */
  readonly organic: number;
  /** Nutrientes disponibles 0-1 por familia. */
  readonly fertility: Readonly<Record<NutrientId, number>>;
  readonly salinity: number;
  readonly compaction: number;
}

export interface CropSpec {
  /** Cuánto se lleva una cosecha plena de cada nutriente (fracción de la fertilidad). */
  readonly uptake: Readonly<Record<NutrientId, number>>;
  /** Las leguminosas fijan nitrógeno en vez de gastarlo: fracción que devuelven al suelo. */
  readonly fixesN?: number;
  /** Tolerancia a la sal 0-1 (1 = ninguna sensibilidad). */
  readonly saltTolerance: number;
}

/** Tasas por día (calibrar en la pasada de calibración). */
export const PARCEL_RATES = {
  /** Meteorización: nutriente que la roca libera por día hacia el tope de la textura. */
  weathering: 0.0004,
  /** Fracción del déficit que se recupera por día sin cosecha ni abono (barbecho). */
  fallowRecovery: 0.002,
  /** Cuánto sube cada nutriente un lote de abono de calidad 1 por unidad de superficie. */
  manureGain: 0.12,
  /** Pérdida de nutrientes por lavado, por día de lluvia fuerte, según textura. */
  leachPerHeavyRain: 0.0015,
  /** Suelo (cm) que se lleva un día de lluvia fuerte con pendiente 1 y sin cobertura. */
  erosionCmPerDay: 0.004,
  /** Salinidad que suma un día de riego sin drenaje en clima seco. */
  saltPerIrrigatedDay: 0.0006,
  /** Fracción de sal que lavan las lluvias con drenaje, por día de lluvia. */
  saltFlush: 0.01,
  /** Profundidad mínima (cm) debajo de la cual la parcela ya no rinde. */
  minDepth: 5,
} as const;

const TEXTURE_CAP: Readonly<Record<Texture, number>> = {
  sand: 0.55,
  loam: 1,
  clay: 0.85,
  silt: 1,
  peat: 0.7,
  ash: 1,
  rocky: 0.3,
};

/** Cuánto retiene la textura de lo que le llueve encima (sand lava rápido). */
const TEXTURE_LEACH: Readonly<Record<Texture, number>> = {
  sand: 1.8,
  loam: 1,
  clay: 0.5,
  silt: 0.9,
  peat: 0.6,
  ash: 0.8,
  rocky: 1.2,
};

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** Tope de fertilidad que da la textura y la materia orgánica. */
export function fertilityCap(soil: ParcelSoil): number {
  return Math.min(1, TEXTURE_CAP[soil.texture] * (0.7 + 0.3 * soil.organic));
}

/** Una parcela virgen: nutrientes en el tope de su textura. */
export function freshParcel(texture: Texture, depth: number, organic = 0.5): ParcelSoil {
  const base: ParcelSoil = {
    texture,
    depth,
    organic,
    fertility: { n: 0, p: 0, k: 0 },
    salinity: 0,
    compaction: 0,
  };
  const cap = fertilityCap(base);
  return { ...base, fertility: { n: cap, p: cap, k: cap } };
}

/** Factor 0-1 del rendimiento: manda el nutriente más escaso (ley del mínimo), la sal, la compactación y la profundidad. */
export function parcelYield(soil: ParcelSoil, crop: CropSpec): number {
  if (soil.depth <= PARCEL_RATES.minDepth) return 0;
  const limiting = Math.min(soil.fertility.n, soil.fertility.p, soil.fertility.k);
  const salt = 1 - clamp01(soil.salinity * (1 - crop.saltTolerance));
  const compact = 1 - 0.5 * clamp01(soil.compaction);
  const depth = Math.min(1, soil.depth / 30);
  return clamp01(limiting) * salt * compact * depth;
}

/** Cosecha: se lleva nutrientes según el cultivo y la plenitud de la cosecha (0-1). Las leguminosas devuelven N. */
export function afterHarvest(soil: ParcelSoil, crop: CropSpec, fullness: number): ParcelSoil {
  const f = clamp01(fullness);
  const fixed = crop.fixesN ?? 0;
  const next = {} as Record<NutrientId, number>;
  for (const id of NUTRIENTS) {
    const gain = id === "n" ? fixed * f * fertilityCap(soil) * 0.5 : 0;
    next[id] = clamp01(soil.fertility[id] - crop.uptake[id] * f + gain);
  }
  return { ...soil, fertility: next, compaction: clamp01(soil.compaction + 0.01 * f) };
}

/** Abono: `amount` unidades de calidad `quality` (estiércol, heces, ceniza) suben los nutrientes hasta el tope y la materia orgánica. */
export function afterManure(
  soil: ParcelSoil,
  amount: number,
  quality: number,
  mix: Readonly<Record<NutrientId, number>> = { n: 1, p: 1, k: 1 },
): ParcelSoil {
  const cap = fertilityCap(soil);
  const next = {} as Record<NutrientId, number>;
  for (const id of NUTRIENTS) {
    next[id] = Math.min(
      cap,
      soil.fertility[id] + PARCEL_RATES.manureGain * amount * quality * mix[id],
    );
  }
  return {
    ...soil,
    fertility: next,
    organic: clamp01(soil.organic + 0.02 * amount * quality),
  };
}

/** Un tramo de `days` días sin cosecha: meteorización y barbecho recuperan, la compactación afloja de a poco. */
export function fallowDays(soil: ParcelSoil, days: number): ParcelSoil {
  if (days <= 0) return soil;
  const cap = fertilityCap(soil);
  const rate = PARCEL_RATES.fallowRecovery + PARCEL_RATES.weathering;
  const keep = pow(1 - rate, days);
  const next = {} as Record<NutrientId, number>;
  for (const id of NUTRIENTS) next[id] = cap - (cap - soil.fertility[id]) * keep;
  return {
    ...soil,
    fertility: next,
    organic: clamp01(soil.organic + 0.00005 * days),
    compaction: clamp01(soil.compaction * pow(0.998, days)),
  };
}

export interface WeatherWear {
  /** Días de lluvia fuerte del tramo. */
  readonly heavyRainDays: number;
  /** Pendiente 0-1 de la parcela. */
  readonly slope: number;
  /** Cobertura vegetal 0-1 (terrazas, pasto, rastrojo): frena la erosión. */
  readonly cover: number;
  /** Días de riego del tramo y si hay drenaje. */
  readonly irrigatedDays: number;
  readonly drained: boolean;
  /** Clima seco evapora y deja la sal. */
  readonly arid: boolean;
}

/** Lo que el clima y el manejo le hacen a la parcela: lavado, erosión, sal. La profundidad perdida no vuelve. */
export function afterWeather(soil: ParcelSoil, w: WeatherWear): ParcelSoil {
  const leach = PARCEL_RATES.leachPerHeavyRain * w.heavyRainDays * TEXTURE_LEACH[soil.texture];
  const retention = 1 - 0.5 * soil.organic;
  const next = {} as Record<NutrientId, number>;
  for (const id of NUTRIENTS) next[id] = clamp01(soil.fertility[id] - leach * retention);
  const eroded =
    PARCEL_RATES.erosionCmPerDay * w.heavyRainDays * clamp01(w.slope) * (1 - clamp01(w.cover));
  const salted = w.arid && !w.drained ? PARCEL_RATES.saltPerIrrigatedDay * w.irrigatedDays : 0;
  const flushed = w.drained ? pow(1 - PARCEL_RATES.saltFlush, w.heavyRainDays) : 1;
  return {
    ...soil,
    fertility: next,
    depth: Math.max(0, soil.depth - eroded),
    salinity: clamp01((soil.salinity + salted) * flushed),
  };
}

/** Nutrientes que salieron del campo en un tramo (para que el ledger los siga: cosecha -> comida -> desechos). */
export function nutrientsRemoved(
  before: ParcelSoil,
  after: ParcelSoil,
): Record<NutrientId, number> {
  const out = {} as Record<NutrientId, number>;
  for (const id of NUTRIENTS) out[id] = Math.max(0, before.fertility[id] - after.fertility[id]);
  return out;
}
