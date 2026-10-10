// Hambruna con causa (economy §«Crisis con causa»): una presión de escasez de alimento, derivada
// del estado y nunca verdad aparte. La fuente es la cuenta de la comida (existencias más la
// cosecha que se espera dentro del horizonte, contra lo que come la gente); el umbral separa la
// escasez de la hambruna; la descarga no mata a nadie: sube el precio creído de la comida, empuja
// a migrar y deja el evento con sus causas. Parte pura: sin RNG, sin estado, sin IO.

import type { CauseRef, EntityRef } from "../../core/index.ts";
import type { PressureReading } from "../causality/index.ts";

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Días hacia adelante que se miran para saber si la comida alcanza. */
export const FAMINE_HORIZON_DAYS = 120;
/** Presión desde la que hay escasez (la gente lo nota) y desde la que hay hambruna. */
export const SCARCITY_THRESHOLD = 0.35;
export const FAMINE_THRESHOLD = 0.7;
/** Histéresis: se sale de un estado cuando la presión baja esto por debajo de su umbral. */
export const FAMINE_HYSTERESIS = 0.08;
/** Cuánto más caro se cree el alimento cuando la presión es 1 (el precio sale de creencias, esto es el tope del empuje). */
export const FAMINE_PRICE_PUSH = 2.5;
/** Fracción máxima de la gente que considera irse cuando la presión es 1. */
export const FAMINE_MIGRATION_PULL = 0.5;

export interface FoodBalance {
  /** Comida guardada en la comunidad, en gramos. */
  readonly stockGrams: number;
  /** Gramos que se esperan cosechar por día, por día del horizonte (0 = día de hoy). */
  readonly harvestGramsOnDay: (dayOffset: number) => number;
  /** Gramos que come la comunidad por día. */
  readonly eatenPerDay: number;
  readonly horizonDays?: number;
}

/** Los días que aguanta la comida: simula el horizonte y devuelve el primer día en que se acaba (o el horizonte). */
export function daysOfFood(b: FoodBalance): number {
  const horizon = b.horizonDays ?? FAMINE_HORIZON_DAYS;
  if (b.eatenPerDay <= 0) return horizon;
  let stock = Math.max(0, b.stockGrams);
  for (let d = 0; d < horizon; d++) {
    stock += Math.max(0, b.harvestGramsOnDay(d)) - b.eatenPerDay;
    if (stock < 0) return d;
  }
  return horizon;
}

/** La presión 0..1: 0 si la comida alcanza todo el horizonte, 1 si no alcanza ni para hoy. */
export function scarcityValue(b: FoodBalance): number {
  const horizon = b.horizonDays ?? FAMINE_HORIZON_DAYS;
  return clamp(1 - daysOfFood(b) / horizon, 0, 1);
}

export type FamineState = "none" | "scarcity" | "famine";

/** El estado con histéresis desde el anterior (para no parpadear en el umbral). */
export function famineState(value: number, previous: FamineState = "none"): FamineState {
  const h = FAMINE_HYSTERESIS;
  if (value >= FAMINE_THRESHOLD) return "famine";
  if (previous === "famine" && value >= FAMINE_THRESHOLD - h) return "famine";
  if (value >= SCARCITY_THRESHOLD) return "scarcity";
  if (previous !== "none" && value >= SCARCITY_THRESHOLD - h) return "scarcity";
  return "none";
}

/** La lectura de presión (`hunger`, comunidad) para el libro de presiones y el inspector. */
export function scarcityReading(args: {
  readonly community: EntityRef;
  readonly balance: FoodBalance;
  readonly sources: readonly CauseRef[];
  readonly system: string;
}): PressureReading {
  return {
    kind: "hunger",
    scope: { kind: "community", ref: args.community },
    value: scarcityValue(args.balance),
    sources: args.sources,
    discharges: [],
    system: args.system,
  };
}

/** Lo que la descarga cambia: se declara, no se aplica (los dueños de precios y de gente lo leen). */
export interface FamineDischarge {
  readonly state: FamineState;
  /** Multiplicador del precio creído de la comida (1 = sin empuje). */
  readonly pricePush: number;
  /** Fracción de la comunidad que considera migrar. */
  readonly migrationPull: number;
}

export function famineDischarge(value: number, state: FamineState): FamineDischarge {
  if (state === "none") return { state, pricePush: 1, migrationPull: 0 };
  const over = clamp((value - SCARCITY_THRESHOLD) / (1 - SCARCITY_THRESHOLD), 0, 1);
  return {
    state,
    pricePush: 1 + over * (FAMINE_PRICE_PUSH - 1),
    migrationPull: state === "famine" ? over * FAMINE_MIGRATION_PULL : 0,
  };
}
