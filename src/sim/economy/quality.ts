// Calidad por lote y su efecto en precio y sabor (economy §1, crafts §11). La calidad (0-1) sale de
// la sesión de oficio; el mercado no la ve entera: quien compra la percibe con error según su
// ojo y paga por lo que cree. Puro: no toca el ledger ni el rng.

import { table } from "../world/index.ts";

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Calidad de referencia: el precio base de `GoodDef` es el de un bien de esta calidad. */
export const REFERENCE_QUALITY = 0.7;

/**
 * Cuánto se multiplica el precio por la calidad creída: 0,4 con lo peor, 1 en la de referencia,
 * 1,5 con lo mejor. Lineal por tramos, sin saltos.
 */
export function qualityPriceFactor(quality: number): number {
  const q = clamp(quality, 0, 1);
  return q <= REFERENCE_QUALITY
    ? 0.4 + (0.6 * q) / REFERENCE_QUALITY
    : 1 + (0.5 * (q - REFERENCE_QUALITY)) / (1 - REFERENCE_QUALITY);
}

/** Lo que cree de la calidad quien mira un lote: la real más su error, que baja con el ojo (0-1). */
export function perceivedQuality(real: number, eye: number, noise: number): number {
  return clamp(real + noise * (1 - clamp(eye, 0, 1)) * 0.3, 0, 1);
}

export type Flavor = "ruin" | "poor" | "plain" | "good" | "fine";

/** Cómo sabe un lote de esa calidad (entra a la narración y al gusto de quien come). */
export function flavorOf(quality: number): Flavor {
  const q = clamp(quality, 0, 1);
  if (q < 0.2) return "ruin";
  if (q < 0.45) return "poor";
  if (q < 0.7) return "plain";
  if (q < 0.9) return "good";
  return "fine";
}

/** Un lote para promediar: gramos y la calidad que tienen. */
export interface QualityLot {
  readonly grams: number;
  readonly quality: number;
}

/** Calidad de la mezcla de lotes: el promedio ponderado por gramos (mezclar no mejora nada). */
export function blendQuality(lots: readonly QualityLot[]): number {
  let g = 0;
  let w = 0;
  for (const l of lots) {
    if (l.grams <= 0) continue;
    g += l.grams;
    w += l.grams * clamp(l.quality, 0, 1);
  }
  return g === 0 ? 0 : w / g;
}

/** La calidad de lo que tiene alguien de cada bien (`good:<id>`), mezclada de los lotes que le llegaron. */
export type LotQualities = Readonly<Record<string, number>>;

/** Calidad por lote de cada agente (economy §1, crafts §11): el ledger guarda gramos, esto la calidad. */
export const LOT_QUALITY = table<LotQualities>("economy.lot_quality");

/** La calidad que se le supone a un bien sin lote registrado (el precio de contenido es el de esta). */
export function qualityOfUnit(lots: LotQualities | undefined, unit: string): number {
  return lots?.[unit] ?? REFERENCE_QUALITY;
}

/**
 * Las calidades después de que a quien tiene `heldGrams` de `unit` le llegan `addGrams` de
 * calidad `quality`: el promedio ponderado (`blendQuality`); lo que ya tenía sin registro vale la
 * referencia.
 */
export function receiveLot(
  lots: LotQualities | undefined,
  unit: string,
  heldGrams: number,
  addGrams: number,
  quality: number,
): LotQualities {
  const blended = blendQuality([
    { grams: heldGrams, quality: qualityOfUnit(lots, unit) },
    { grams: addGrams, quality },
  ]);
  return {
    ...lots,
    [unit]: Math.round((addGrams > 0 || heldGrams > 0 ? blended : quality) * 1000) / 1000,
  };
}
