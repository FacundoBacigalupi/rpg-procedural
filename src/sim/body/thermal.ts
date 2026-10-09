// Balance térmico del cuerpo (body-health §7), parte pura: la temperatura del núcleo (`coreTemp`)
// se mueve según lo que el cuerpo produce (basal, esfuerzo, escalofríos) y lo que pierde o gana
// con el aire (temperatura, viento, mojado, ropa, refugio, fuego) y con el sudor. Sin IO ni
// estado: el cableado a `Body` y a la vida queda aparte. Constantes sin calibrar.

import { table } from "../world/index.ts";

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/**
 * La temperatura del núcleo de una persona, aparte del `Body` (como `INFECTION`). Sin fila, el
 * núcleo está en `CORE_NORMAL_C`: solo se guarda mientras se aparta de lo normal.
 */
export interface CoreTemp {
  readonly coreC: number;
  /** Hasta cuándo está calculado. */
  readonly at: number;
}
export const THERMAL = table<CoreTemp>("body.thermal");

/** Temperatura normal del núcleo (°C). */
export const CORE_NORMAL_C = 37;
/** Temperatura de la piel que el aire enfría o calienta (°C). */
const SKIN_C = 33;
/** Superficie del cuerpo (m²) y calor específico del cuerpo (J/kg·K). */
const BODY_AREA = 1.8;
const BODY_HEAT_CAPACITY = 3470;
/** Producción basal (W) y tope extra por escalofríos (W). */
const BASAL_W = 80;
const SHIVER_MAX_W = 220;
/** Tope de enfriamiento por sudor (W), con aire seco y cuerpo hidratado. */
const SWEAT_MAX_W = 550;
/** Calor latente del sudor (J por litro). */
const SWEAT_J_PER_L = 2.43e6;
/** Resistencia del aire quieto (m²·K/W) y aislamiento de 1 clo. */
const R_AIR = 0.11;
const R_PER_CLO = 0.155;

/** El ambiente que siente un cuerpo (afuera o adentro). */
export interface ThermalEnv {
  /** Temperatura del aire (°C), ya con la hora y la estación. */
  readonly airC: number;
  /** Viento (m/s) donde está. */
  readonly windMs: number;
  /** 0-1: humedad del aire (frena el sudor). */
  readonly humidity: number;
  /** 0-1: cuánta de la ropa y la piel está mojada. */
  readonly wet: number;
  /** 0-1: reparo del viento y la lluvia (techo, pared, cueva). */
  readonly shelter: number;
  /** °C equivalentes que suma un fuego cercano o el sol directo (0 si no hay). */
  readonly radiantC: number;
}

/** Lo que lleva puesto: aislamiento sumado de las prendas (propiedad del ítem) y su cortaviento. */
export interface Clothing {
  /** Aislamiento total en clo (0 desnudo, 1 ropa de calle, 3+ abrigo de invierno). */
  readonly clo: number;
  /** 0-1: cuánto frena el viento. */
  readonly windproof: number;
  /** 0-1: cuánto del cuerpo cubre (el resto queda expuesto: manos, cara). */
  readonly coverage: number;
}

export const NAKED: Clothing = { clo: 0, windproof: 0, coverage: 0 };

/** Un ambiente templado de aldea: el valor por defecto sin efecto. */
export const TEMPERATE: ThermalEnv = {
  airC: 18,
  windMs: 1,
  humidity: 0.5,
  wet: 0,
  shelter: 0,
  radiantC: 0,
};

/** Temperatura que siente la piel: el aire, el viento que no frena la ropa ni el reparo, y el fuego. */
export function effectiveAirC(env: ThermalEnv, clothing: Clothing): number {
  const wind = env.windMs * (1 - env.shelter) * (1 - 0.8 * clothing.windproof);
  // Sensación térmica simple: solo enfría cuando el aire está más frío que la piel.
  const chill = env.airC < SKIN_C ? Math.min(0.9, 0.1 * Math.sqrt(wind)) * (SKIN_C - env.airC) : 0;
  return env.airC - chill + env.radiantC;
}

/** Aislamiento efectivo (clo): la ropa mojada aísla mucho menos. */
export function effectiveClo(env: ThermalEnv, clothing: Clothing): number {
  return clothing.clo * (1 - 0.7 * env.wet * (1 - env.shelter * 0.5));
}

/** Potencia (W) que el cuerpo pierde hacia el aire; negativa si el aire lo calienta. */
export function heatLossW(env: ThermalEnv, clothing: Clothing): number {
  const r = R_AIR + R_PER_CLO * effectiveClo(env, clothing);
  const wetting = 1 + 0.6 * env.wet; // la evaporación de lo mojado se lleva calor
  return (BODY_AREA * (SKIN_C - effectiveAirC(env, clothing)) * wetting) / r;
}

export interface ThermalStep {
  readonly coreC: number;
  /** Litros de agua perdidos por sudor en el paso. */
  readonly sweatL: number;
  /** Potencia producida (W) por metabolismo y escalofríos, para el gasto de energía. */
  readonly producedW: number;
}

/**
 * Un paso de `hours` horas. `activityKcal` es el multiplicador de `ACTIVITY_LOAD` (1 reposo,
 * 3.4 esfuerzo fuerte); `hydration` 0-1 (1 bien hidratado) limita el sudor. El esfuerzo produce
 * calor de más; con armadura (aislamiento alto) el desierto lo vuelve golpe de calor.
 */
export function stepCore(
  coreC: number,
  massKg: number,
  env: ThermalEnv,
  clothing: Clothing,
  activityKcal: number,
  hydration: number,
  hours: number,
): ThermalStep {
  const loss = heatLossW(env, clothing);
  const base = BASAL_W * activityKcal;
  const shiver =
    coreC < CORE_NORMAL_C && coreC > 31
      ? clamp((CORE_NORMAL_C + 0.3 - coreC) / 1.2, 0, 1) * SHIVER_MAX_W
      : 0;
  const produced = base + shiver;
  // Sudor: solo cuando sobra calor, y la humedad , la sed y la ropa gruesa lo frenan.
  const surplus = produced - loss;
  const cap =
    (SWEAT_MAX_W * (1 - 0.7 * env.humidity) * clamp(hydration, 0, 1)) /
    (1 + 0.5 * clothing.clo * clothing.coverage);
  const evap = coreC >= CORE_NORMAL_C - 0.2 ? clamp(surplus, 0, cap) : 0;
  const netW = surplus - evap;
  const dt = hours * 3600;
  const next = coreC + (netW * dt) / (massKg * BODY_HEAT_CAPACITY);
  return { coreC: clamp(next, 20, 46), sweatL: (evap * dt) / SWEAT_J_PER_L, producedW: produced };
}

export type ThermalStage =
  | "heatstroke"
  | "heat_exhaustion"
  | "normal"
  | "shivering"
  | "hypothermia"
  | "severe_hypothermia"
  | "cold_coma";

/** En qué estado está el cuerpo por la temperatura del núcleo. */
export function thermalStage(coreC: number): ThermalStage {
  if (coreC >= 40) return "heatstroke";
  if (coreC >= 38.5) return "heat_exhaustion";
  if (coreC >= 36) return "normal";
  if (coreC >= 35) return "shivering";
  if (coreC >= 32) return "hypothermia";
  if (coreC >= 30) return "severe_hypothermia";
  return "cold_coma";
}

/** Causa de muerte térmica, o null si el núcleo está dentro de lo que se aguanta. */
export function thermalDeath(coreC: number): "hypothermia" | "heatstroke" | null {
  if (coreC <= 27) return "hypothermia";
  if (coreC >= 42.5) return "heatstroke";
  return null;
}

/** Multiplicador de destreza (0-1): el frío entumece y el calor extremo marea. */
export function dexterityFactor(coreC: number): number {
  if (coreC >= 36 && coreC < 38.5) return 1;
  if (coreC >= 38.5) return clamp(1 - (coreC - 38.5) * 0.25, 0.3, 1);
  return clamp(1 - (36 - coreC) * 0.18, 0.1, 1);
}

/** Inconsciente por temperatura (confusión profunda en el frío, golpe de calor avanzado). */
export function thermalUnconscious(coreC: number): boolean {
  return coreC < 30 || coreC >= 41.5;
}

/**
 * Congelación: gravedad (0-1) que suma una hora de exposición de las extremidades. Solo con la
 * piel efectiva bajo cero; lo que la ropa no cubre y lo mojado la aceleran. Es una lesión de
 * parte con causa; con gravedad alta termina en pérdida de dedos.
 */
export function frostbitePerHour(env: ThermalEnv, clothing: Clothing): number {
  const t = effectiveAirC(env, clothing);
  if (t >= 0) return 0;
  const exposed = 1 - 0.8 * clothing.coverage;
  const wetness = 1 + env.wet;
  return clamp((-t / 40) * 0.12 * exposed * wetness, 0, 0.5);
}

/** Gravedad desde la que la congelación cuesta dedos (amputación). */
export const FROSTBITE_AMPUTATION = 0.8;

/** Agua por hora (L) que suda en equilibrio, para alimentar la sed del cuerpo. */
export function sweatLitersPerHour(
  env: ThermalEnv,
  clothing: Clothing,
  activityKcal: number,
  massKg: number,
): number {
  return stepCore(CORE_NORMAL_C, massKg, env, clothing, activityKcal, 1, 1).sweatL;
}
