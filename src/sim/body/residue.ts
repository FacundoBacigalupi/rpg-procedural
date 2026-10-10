// Toxicidad de lo ingerido con `Essence` (body-health §9, crafts §4), parte pura: los residuos que
// deja un preparado según su pureza (la tensión residual de la receta), cómo se acumulan en el
// cuerpo y se purgan, qué le hacen al cultivo (eficiencia y desviaciones) y la sobrecarga del
// mortal que come algo demasiado potente. Sin IO ni RNG: quien lo cablee tira los dados con el
// riesgo que devuelven `deviationRisk` y `overload`. Opt-in, sin cablear a la aldea. Constantes
// sin calibrar. La `Essence` se cuenta en unidades del mundo y se conserva: lo ingerido se reparte
// entre lo que el cuerpo absorbe, el residuo que queda y lo que se disipa.

import { table } from "../world/index.ts";

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/** Residuo acumulado de una persona, aparte del `Body`. Sin fila no hay residuo. */
export interface ResidueLoad {
  /** Residuo en unidades de `Essence` impura retenida. */
  readonly load: number;
  /** Hasta cuándo está calculado (ticks). */
  readonly at: number;
}
export const RESIDUE = table<ResidueLoad>("body.residue");

/** Lo que una ingesta de `Essence` deja: lo útil y el residuo (suman lo ingerido). */
export interface IntakeSplit {
  readonly useful: number;
  readonly residue: number;
}

/** Reparte `essence` según la pureza (0-1): el residuo es la parte impura. */
export function splitByPurity(essence: number, purity: number): IntakeSplit {
  const e = Math.max(0, essence);
  const p = clamp(purity, 0, 1);
  const residue = e * (1 - p);
  return { useful: e - residue, residue };
}

/** Cómo se purga: tiempo (días de cuidado) o recursos (más rápido, con costo). */
export interface PurgeMethod {
  /** Fracción de la capacidad purgada por día (con el cuerpo en reposo). */
  readonly ratePerDay: number;
  /** `Essence` o bienes que cuesta por unidad de residuo purgada. */
  readonly costPerUnit: number;
}

/** Purga lenta y gratis: el cuerpo la va sacando solo. */
export const NATURAL_PURGE: PurgeMethod = { ratePerDay: 0.02, costPerUnit: 0 };

/**
 * Deja pasar `days` y purga con `method` y la capacidad del cuerpo (unidades de `Essence` que
 * soporta). Devuelve el residuo que queda y lo purgado (con su costo). Lineal y sin pasar de cero.
 */
export function stepResidue(
  load: number,
  days: number,
  capacity: number,
  method: PurgeMethod = NATURAL_PURGE,
): { readonly load: number; readonly purged: number; readonly cost: number } {
  const l = Math.max(0, load);
  const perDay = Math.max(0, method.ratePerDay) * Math.max(0, capacity);
  const purged = Math.min(l, perDay * Math.max(0, days));
  return { load: l - purged, purged, cost: purged * Math.max(0, method.costPerUnit) };
}

/** Días que lleva purgar `load` con `method`, o Infinity si no purga nada. */
export function purgeDays(
  load: number,
  capacity: number,
  method: PurgeMethod = NATURAL_PURGE,
): number {
  const per = Math.max(0, method.ratePerDay) * Math.max(0, capacity);
  return per <= 0 ? Number.POSITIVE_INFINITY : Math.max(0, load) / per;
}

/** Carga relativa: residuo sobre lo que el cuerpo soporta. */
export function residueRatio(load: number, capacity: number): number {
  return capacity <= 0 ? Number.POSITIVE_INFINITY : Math.max(0, load) / capacity;
}

/** Multiplicador (0-1] de la eficiencia de absorber y cultivar: baja con la carga relativa. */
export function cultivationEfficiency(load: number, capacity: number): number {
  const r = residueRatio(load, capacity);
  return Number.isFinite(r) ? 1 / (1 + r * r) : 0;
}

/**
 * Riesgo diario (0-1) de una desviación al cultivar, que quien lo cablee tira con su RNG. Cero
 * mientras el residuo no pase de la mitad de lo soportado; sube con el exceso y baja con la
 * estabilidad del fundamento (0-1).
 */
export function deviationRisk(load: number, capacity: number, stability: number): number {
  const r = residueRatio(load, capacity);
  if (!Number.isFinite(r)) return 1;
  const over = Math.max(0, r - 0.5);
  return clamp(over * 0.2 * (1.5 - clamp(stability, 0, 1)), 0, 1);
}

/** Cuerpo frente a una ingesta potente. */
export interface OverloadBody {
  /** `Essence` que el cuerpo puede absorber de una vez sin romperse. */
  readonly capacity: number;
  /** Afinidad del cuerpo con la `Essence` (0-1): meridianos, constitución, linaje. */
  readonly affinity: number;
}

export type OverloadStage = "none" | "fever" | "burned" | "fatal";

export interface OverloadResult {
  readonly stage: OverloadStage;
  /** Lo que el cuerpo toma. */
  readonly absorbed: number;
  /** Lo que se disipa al entorno (no se pierde: lo recibe el aire). */
  readonly dissipated: number;
  /** Fiebre (0-1) y meridianos quemados (0-1), para las heridas y el cuerpo. */
  readonly fever: number;
  readonly meridianDamage: number;
  /** Si el cuerpo, sobrecargado pero apto, despierta algo (decide el cuerpo, no el azar). */
  readonly awakens: boolean;
}

/**
 * Un mortal que come algo demasiado potente: el exceso sobre su capacidad es la sobrecarga. Hasta
 * 1x de capacidad no pasa nada; hasta 1.5x fiebre; hasta 2.5x meridianos quemados; más, la
 * muerte. Con más afinidad el cuerpo aguanta más (escala el tope) y, en la banda de fiebre o
 * quemadura con afinidad alta, despierta. Determinista: no usa suerte.
 */
export function overload(body: OverloadBody, intake: number): OverloadResult {
  const cap = Math.max(1e-9, body.capacity);
  const aff = clamp(body.affinity, 0, 1);
  const e = Math.max(0, intake);
  const limit = cap * (1 + aff);
  const ratio = e / limit;
  if (ratio <= 1) {
    return {
      stage: "none",
      absorbed: e,
      dissipated: 0,
      fever: 0,
      meridianDamage: 0,
      awakens: false,
    };
  }
  const stage: OverloadStage = ratio <= 1.5 ? "fever" : ratio <= 2.5 ? "burned" : "fatal";
  const absorbed = stage === "fatal" ? 0 : limit;
  return {
    stage,
    absorbed,
    dissipated: e - absorbed,
    fever: clamp((ratio - 1) / 1.5, 0, 1),
    meridianDamage: stage === "fever" ? 0 : clamp(ratio - 1.5, 0, 1),
    awakens: stage !== "fatal" && aff >= 0.6,
  };
}
