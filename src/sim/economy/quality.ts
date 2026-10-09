// Calidad por lote y su efecto en precio y sabor (economy §1, crafts §11). La calidad (0-1) sale de
// la sesión de oficio; el mercado no la ve entera: quien compra la percibe con error según su
// ojo y paga por lo que cree. Puro: no toca el ledger ni el rng.

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
