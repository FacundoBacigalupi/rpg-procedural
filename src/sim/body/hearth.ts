// Hogueras y hogares encendidos (body-health §7, crafts §fuegos), parte pura: un fuego es una fila
// con combustible que se gasta. La leña no se inventa ni se borra: vive en una cuenta del ledger (la
// del titular del hogar) y lo quemado sale hacia un sumidero con su evento (lo hace el proceso de
// `game/life`). Acá solo la tabla y las cuentas: cuánto se quema, con qué intensidad calienta y
// cuánto suma a quien está cerca (`fireRadiantC`). Sin IO ni RNG. Constantes sin calibrar.

import { sqrt } from "../../core/math/index.ts";
import { table } from "../world/index.ts";
import { fireRadiantC } from "./thermal.ts";

/**
 * Un fuego encendido en un espacio. Sin fila no hay fuego; se apaga (se borra la fila) al quedarse
 * sin leña. El combustible NO está en la fila: es el saldo de `holder` en `fuelUnit` en el ledger.
 */
export interface Hearth {
  /** Clave del espacio del grafo donde arde (quien está ahí lo siente). */
  readonly space: string;
  /** Cuenta del ledger (clave de titular) de donde se toma la leña. */
  readonly holder: string;
  /** Unidad del ledger que se quema (gramos). */
  readonly fuelUnit: string;
  /** Gramos por hora a fuego pleno. */
  readonly burnGramsPerHour: number;
  /** Horas por día que se mantiene encendido (el resto del día está apagado o en brasas). */
  readonly litHoursPerDay: number;
  /** Intensidad efectiva 0-1 del último paso (fracción del día encendido y de la leña disponible). */
  readonly intensity: number;
  /** Hasta cuándo está calculado. */
  readonly at: number;
}
export const HEARTH = table<Hearth>("body.hearth");

/** Gramos por hora de un hogar común a fuego pleno (~1,5 kg/h). */
export const HEARTH_BURN_G_PER_H = 1500;

/**
 * Lo que se quema en `days` días con `fuelG` disponibles, y la intensidad efectiva del tramo
 * (fracción de lo que el fuego habría quemado si hubiera tenido leña de sobra, por la fracción del
 * día encendido). Entero en gramos: el ledger no tiene decimales.
 */
export function hearthBurn(
  h: Pick<Hearth, "burnGramsPerHour" | "litHoursPerDay">,
  fuelG: number,
  days: number,
): { burnedG: number; intensity: number } {
  const lit = Math.min(24, Math.max(0, h.litHoursPerDay));
  const want = Math.round(h.burnGramsPerHour * lit * Math.max(0, days));
  const burnedG = Math.max(0, Math.min(Math.floor(fuelG), want));
  const fed = want > 0 ? burnedG / want : 0;
  return { burnedG, intensity: fed * (lit / 24) };
}

/** Distancia típica (m) a un fuego en un espacio de ese tamaño: la mitad de su lado. */
export function hearthDistanceM(areaM2: number): number {
  return Math.max(1, 0.5 * sqrt(Math.max(1, areaM2)));
}

/** Los °C equivalentes que suman los fuegos de un espacio a quien está ahí. */
export function hearthRadiantC(
  hearths: readonly Pick<Hearth, "intensity">[],
  areaM2: number,
): number {
  const distanceM = hearthDistanceM(areaM2);
  return fireRadiantC(hearths.map((h) => ({ intensity: h.intensity, distanceM })));
}
