// La forma de la descarga (causality §9): `hazard = f(presión − umbral)` con una sigmoide por tipo
// que sale de `content/pressures/`. Por debajo del piso no hay descarga (no hay motines sin
// agravio); una chispa baja el umbral efectivo por un rato.

import { contentId, defineContent, logistic, z } from "../../core/index.ts";

export const PressureCurve = z.strictObject({
  /** El tipo de presión al que aplica. */
  id: contentId,
  name: z.string().min(1),
  /** Por debajo, la descarga es imposible. */
  floor: z.number().min(0).max(1),
  /** Donde la probabilidad llega a la mitad de su máximo. */
  threshold: z.number().min(0).max(1),
  steepness: z.number().positive(),
  /** Probabilidad por tick en lo más alto. */
  maxHazard: z.number().min(0).max(1),
});
export type PressureCurve = z.infer<typeof PressureCurve>;

export const PRESSURE_CURVES = defineContent("pressures", PressureCurve);

/**
 * Probabilidad por tick de que un proceso descargue la presión. `spark` (0..1) es lo que una
 * chispa bajó el umbral; `opportunity` (0..1) escala por lo que el estado permite. Sin
 * personalidad todavía: entra con npc-psychology.
 */
export function hazardOf(
  curve: PressureCurve,
  value: number,
  opts: { readonly spark?: number; readonly opportunity?: number } = {},
): number {
  const spark = opts.spark ?? 0;
  const opportunity = opts.opportunity ?? 1;
  if (value < curve.floor - spark) return 0;
  const x = curve.steepness * (value - (curve.threshold - spark));
  return curve.maxHazard * logistic(x) * Math.min(1, Math.max(0, opportunity));
}
