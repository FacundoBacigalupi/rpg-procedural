// Agua por fuente y tratamiento (body-health Â§5): de dÃ³nde sale el agua que se bebe, cuÃ¡nta
// carga, barro y sal trae, y quÃ© le hacen hervirla o filtrarla. Puro: sin IO ni estado; el
// cableado (quÃ© fuente usa cada quien) vive en `game/life`.

import { CLEAN_WATER, netHydration, type WaterQuality } from "./nutrition.ts";

export type WaterSourceKind = "well" | "river" | "rain" | "sea" | "stagnant";

export type WaterTreatment = "none" | "boil" | "filter" | "boil_filter" | "settle";

/** Lo que una fuente aporta antes de tratarla (calibraciÃ³n abierta). */
export interface SourceInput {
  readonly kind: WaterSourceKind;
  /** Carga de patÃ³geno que ya tiene el agua (0-1; la de `WELL_TAINT` para un pozo). */
  readonly load?: number;
  /** 0-1: cuÃ¡nto arrastra el cauce (crecida, lluvia reciente): turbiedad de rÃ­os. */
  readonly runoff?: number;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Calidad base de una fuente. La lluvia es limpia; el rÃ­o barroso con crecida; el mar, salado. */
export function sourceWater(s: SourceInput): WaterQuality {
  const load = clamp01(s.load ?? 0);
  const runoff = clamp01(s.runoff ?? 0);
  switch (s.kind) {
    case "well":
      return { ...CLEAN_WATER, load };
    case "rain":
      return { ...CLEAN_WATER, load: load * 0.2, turbidity: 0.02 };
    case "river":
      return { ...CLEAN_WATER, load: Math.max(load, 0.05), turbidity: clamp01(0.1 + 0.8 * runoff) };
    case "sea":
      return { load, turbidity: 0.1, treated: 0, salinity: 0.9 };
    case "stagnant":
      return { ...CLEAN_WATER, load: Math.max(load, 0.3), turbidity: 0.5, salinity: 0.1 };
  }
}

/** CuÃ¡nta carga quita cada tratamiento, cuÃ¡nta turbiedad y cuÃ¡nta sal (la sal no sale con ninguno). */
const WaterTreatment: Readonly<
  Record<WaterTreatment, { readonly kills: number; readonly clears: number }>
> = {
  none: { kills: 0, clears: 0 },
  settle: { kills: 0.1, clears: 0.6 },
  filter: { kills: 0.6, clears: 0.9 },
  boil: { kills: 0.99, clears: 0 },
  boil_filter: { kills: 0.999, clears: 0.9 },
};

/** Aplica un tratamiento. Hervir no aclara; filtrar no mata todo; ninguno quita la sal. */
export function treatWater(w: WaterQuality, t: WaterTreatment): WaterQuality {
  const e = WaterTreatment[t];
  return {
    load: w.load,
    turbidity: clamp01(w.turbidity * (1 - e.clears)),
    treated: clamp01(1 - (1 - w.treated) * (1 - e.kills)),
    salinity: w.salinity,
  };
}

/**
 * Beber `liters` de esta agua: lo que hidrata (neto; negativo si la sal deshidrata) y si hace
 * falta tragar a ciegas (no se nota nada malo: `warning` bajo).
 */
export function drinkWater(liters: number, w: WaterQuality): { readonly hydration: number } {
  return { hydration: netHydration(liters, w) };
}
