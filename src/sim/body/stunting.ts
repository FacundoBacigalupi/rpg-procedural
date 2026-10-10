// Crecimiento infantil y secuelas permanentes del hambre (body-health §5). Puro: sin RNG ni IO.
// El efecto `growth` de `DEFICIENCY_EFFECTS` (1 = sin efecto) frena el crecimiento mientras dura
// la carencia; lo que se perdió en los años sensibles no se recupera (talla) o se recupera poco
// (cognición). Sin carencia (`growth` = 1, `cognition` = 1) no se acumula nada.

import { table } from "../world/index.ts";

/** Marcas permanentes de la infancia: 0 = ninguna, 1 = el máximo posible. */
export interface GrowthSequelae {
  /** Fracción de la talla adulta que no se alcanzó (hasta `MAX_STUNT`). */
  readonly stunt: number;
  /** Fracción de cognición que no se desarrolló (hasta `MAX_COGNITIVE_LOSS`). */
  readonly cognitiveLoss: number;
}

export const NO_SEQUELAE: GrowthSequelae = { stunt: 0, cognitiveLoss: 0 };

/** Secuelas por niño; sin fila, ninguna. Las escribe solo `life.growth-sequelae`. */
export const GROWTH_SEQUELAE = table<GrowthSequelae>("body.growth_sequelae");

export const MAX_STUNT = 0.2;
export const MAX_COGNITIVE_LOSS = 0.3;
/** Años en que el cuerpo aún crece (coincide con `growth(ageYears)` de `state.ts`). */
const GROWTH_END = 18;
/** Años del período sensible del cerebro. */
const BRAIN_END = 5;
/** Pérdida de talla por día de déficit total en la edad de más crecimiento. */
const STUNT_PER_DAY = 0.0004;
const COGNITION_PER_DAY = 0.0006;

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/** Cuánto pesa un día de carencia a esta edad (los primeros años y la adolescencia pesan más). */
export function growthSensitivity(ageYears: number): number {
  if (ageYears < 0 || ageYears >= GROWTH_END) return 0;
  if (ageYears < 3) return 1;
  if (ageYears < BRAIN_END) return 0.8;
  if (ageYears < 12) return 0.35;
  return 0.5;
}

/** Un paso de `days` días con los efectos de carencia de ese período. Sin carencia, igual. */
export function stepSequelae(
  prev: GrowthSequelae,
  ageYears: number,
  effects: { readonly growth: number; readonly cognition: number },
  days: number,
): GrowthSequelae {
  const s = growthSensitivity(ageYears);
  if (s === 0 || days <= 0) return prev;
  const g = clamp(1 - effects.growth, 0, 1);
  const c = ageYears < BRAIN_END ? clamp(1 - effects.cognition, 0, 1) : 0;
  if (g === 0 && c === 0) return prev;
  return {
    stunt: Math.min(MAX_STUNT, prev.stunt + g * s * STUNT_PER_DAY * days),
    cognitiveLoss: Math.min(
      MAX_COGNITIVE_LOSS,
      prev.cognitiveLoss + c * s * COGNITION_PER_DAY * days,
    ),
  };
}

/** Multiplicador de la talla adulta (1 = sin secuela). */
export function heightFactor(s: GrowthSequelae): number {
  return 1 - s.stunt;
}

/** Multiplicador permanente de cognición (1 = sin secuela). */
export function cognitionFactor(s: GrowthSequelae): number {
  return 1 - s.cognitiveLoss;
}

/** Hay secuela que valga la pena guardar o mostrar (para no escribir filas vacías). */
export function hasSequelae(s: GrowthSequelae): boolean {
  return s.stunt > 0 || s.cognitiveLoss > 0;
}
