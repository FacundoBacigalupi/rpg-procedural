// Balance térmico del cuerpo (body-health §7), parte pura: la temperatura del núcleo (`coreTemp`)
// se mueve según lo que el cuerpo produce (basal, esfuerzo, escalofríos) y lo que pierde o gana
// con el aire (temperatura, viento, mojado, ropa, refugio, fuego) y con el sudor. Sin IO ni
// estado: el cableado a `Body` y a la vida queda aparte. Constantes sin calibrar.

import type { EventId } from "../../core/index.ts";
import { exp, pow } from "../../core/math/index.ts";
import { table } from "../world/index.ts";
import type { BodyCapabilities } from "./capabilities.ts";
import type { Scar } from "./state.ts";

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

/**
 * Sudor sostenido (L/h), aparte del `Body` y de `THERMAL`: lo calcula `life.thermal` con el esfuerzo
 * y lo lee el proceso del cuerpo como pérdida extra de agua (sed). Sin fila no hay sudor extra.
 */
export interface SweatRate {
  readonly litersPerHour: number;
  /** Hasta cuándo está calculado. */
  readonly at: number;
}
export const SWEAT = table<SweatRate>("body.sweat");

/** Temperatura normal del núcleo (°C). */
export const CORE_NORMAL_C = 37;
/** Temperatura de la piel que el aire enfría o calienta (°C). */
const SKIN_C = 33;
/** Superficie del cuerpo (m²) del adulto de referencia y calor específico del cuerpo (J/kg·K). */
const BODY_AREA = 1.8;
/**
 * Masa (kg) desde la que el cuerpo cuenta como adulto de referencia: por encima, constantes
 * calibradas tal cual; por debajo (niños, bebés) la superficie escala con masa^(2/3) y el
 * metabolismo con masa^(3/4), así que por kg pierden y producen más calor sin morir de más.
 */
export const REFERENCE_MASS_KG = 45;

/** Factor de escala (0-1] de un cuerpo respecto del de referencia. */
export function massScale(massKg: number): number {
  return clamp(massKg / REFERENCE_MASS_KG, 0.02, 1);
}
/** Superficie (m²) de un cuerpo de esa masa. */
export function bodyArea(massKg: number): number {
  return BODY_AREA * pow(massScale(massKg), 2 / 3);
}
/** Escala del metabolismo y de las capacidades de escalofrío y sudor (masa^(3/4)). */
function metabolicScale(massKg: number): number {
  return pow(massScale(massKg), 0.75);
}
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

/** Gradiente adiabático medio de la atmósfera (°C por metro de altura). */
export const LAPSE_RATE_C_PER_M = 0.0065;
/** Altura de escala de la presión (m): la presión cae a 1/e cada tanto. */
const PRESSURE_SCALE_M = 8400;

/** Temperatura del aire (°C) a `altitudeM` si a `baseM` es `airC` (aire que baja de temperatura al subir). */
export function airCAtAltitude(airC: number, baseM: number, altitudeM: number): number {
  return airC - LAPSE_RATE_C_PER_M * (altitudeM - baseM);
}

/** Presión relativa (1 al nivel del mar) a una altitud: decae exponencial con la altura. */
export function relativePressure(altitudeM: number): number {
  return exp(-Math.max(-500, altitudeM) / PRESSURE_SCALE_M);
}

/**
 * Ajusta el ambiente por altitud y por un ambiente de qi: el aire se enfría con el gradiente
 * adiabático respecto de la altitud de referencia (adentro, filtrado por `leak` 0-1), y
 * `qiC` (°C equivalentes, negativo enfría y positivo calienta; densidad de qi, formación o lugar)
 * se suma al calor radiante. Con `altitudeM === baseM` y `qiC === 0` devuelve el mismo ambiente.
 */
export function altitudeEnv(
  env: ThermalEnv,
  baseM: number,
  altitudeM: number,
  qiC: number = 0,
  leak: number = 1,
): ThermalEnv {
  if (altitudeM === baseM && qiC === 0) return env;
  const delta = airCAtAltitude(0, baseM, altitudeM) * clamp(leak, 0, 1);
  // El aire ralo arrastra menos: el viento enfría un poco menos por m/s con poca presión.
  const thin = 0.5 + 0.5 * relativePressure(altitudeM);
  return {
    ...env,
    airC: env.airC + delta,
    windMs: env.windMs * thin,
    radiantC: env.radiantC + qiC,
  };
}

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
export function heatLossW(
  env: ThermalEnv,
  clothing: Clothing,
  massKg: number = REFERENCE_MASS_KG,
): number {
  const r = R_AIR + R_PER_CLO * effectiveClo(env, clothing);
  const wetting = 1 + 0.6 * env.wet; // la evaporación de lo mojado se lleva calor
  return (bodyArea(massKg) * (SKIN_C - effectiveAirC(env, clothing)) * wetting) / r;
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
  const loss = heatLossW(env, clothing, massKg);
  const ms = metabolicScale(massKg);
  const base = BASAL_W * ms * activityKcal;
  const shiver =
    coreC < CORE_NORMAL_C && coreC > 31
      ? clamp((CORE_NORMAL_C + 0.3 - coreC) / 1.2, 0, 1) * SHIVER_MAX_W * ms
      : 0;
  const produced = base + shiver;
  // Sudor: solo cuando sobra calor, y la humedad , la sed y la ropa gruesa lo frenan.
  const surplus = produced - loss;
  const cap =
    (SWEAT_MAX_W * ms * (1 - 0.7 * env.humidity) * clamp(hydration, 0, 1)) /
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

/** Partes que la congelación lesiona, con cuánto de la exposición recibe cada una. */
export const FROSTBITE_PARTS = ["hands", "feet", "face"] as const;
export type FrostbitePart = (typeof FROSTBITE_PARTS)[number];
const FROSTBITE_EXPOSURE: Readonly<Record<FrostbitePart, number>> = {
  hands: 1,
  feet: 0.8,
  face: 0.5,
};
/** Curación por hora de una congelación leve con la piel abrigada. */
export const FROSTBITE_HEAL_PER_HOUR = 0.01;

/**
 * Gravedad (0-1) de la congelación por parte, aparte del `Body` (como `THERMAL`): sin fila no hay
 * lesión. Es una lesión de parte con gravedad acumulada; la amputación la decide quien la aplica.
 */
export interface FrostbiteState {
  readonly hands: number;
  readonly feet: number;
  readonly face: number;
  /** Hasta cuándo está calculado. */
  readonly at: number;
}
export const FROSTBITE = table<FrostbiteState>("body.frostbite");

export const NO_FROSTBITE: FrostbiteState = { hands: 0, feet: 0, face: 0, at: 0 };

/**
 * Un paso de `hours` horas: la gravedad sube con la exposición (`frostbitePerHour` por la
 * parte), hasta el doble si el núcleo está frío (vasoconstricción periférica), y baja despacio
 * cuando la piel está sobre cero (`FROSTBITE_HEAL_PER_HOUR`); lo necrosado no se cura.
 */
export function stepFrostbite(
  state: FrostbiteState,
  env: ThermalEnv,
  clothing: Clothing,
  coreC: number,
  hours: number,
  now: number,
): FrostbiteState {
  const perHour = frostbitePerHour(env, clothing);
  const core = 1 + clamp((CORE_NORMAL_C - 1.5 - coreC) / 3, 0, 1);
  const next = (v: number, part: FrostbitePart): number => {
    if (v >= FROSTBITE_AMPUTATION) return v;
    if (perHour > 0) return clamp(v + perHour * FROSTBITE_EXPOSURE[part] * core * hours, 0, 1);
    return clamp(v - FROSTBITE_HEAL_PER_HOUR * hours, 0, 1);
  };
  return {
    hands: next(state.hands, "hands"),
    feet: next(state.feet, "feet"),
    face: next(state.face, "face"),
    at: now,
  };
}

export type FrostbiteStage = "none" | "frostnip" | "superficial" | "deep" | "necrotic";

/** Etapa de una parte por su gravedad. */
export function frostbiteStage(severity: number): FrostbiteStage {
  if (severity >= FROSTBITE_AMPUTATION) return "necrotic";
  if (severity >= 0.5) return "deep";
  if (severity >= 0.2) return "superficial";
  if (severity > 0.02) return "frostnip";
  return "none";
}

/** Partes con tejido muerto: lo que cuesta dedos o pie, y no vuelve. */
export function frostbiteAmputations(state: FrostbiteState): FrostbitePart[] {
  return FROSTBITE_PARTS.filter((p) => frostbiteStage(state[p]) === "necrotic");
}

/** Destreza (0-1) que deja la congelación de las manos. */
export function frostbiteHandFactor(state: FrostbiteState): number {
  return clamp(1 - state.hands * 0.9, 0.1, 1);
}
/** Movilidad (0-1) que deja la congelación de los pies. */
export function frostbiteMobilityFactor(state: FrostbiteState): number {
  return clamp(1 - state.feet * 0.8, 0.2, 1);
}

/** Una parte perdida por congelación: permanente, con el evento que la causó. */
export interface LostPart {
  readonly part: FrostbitePart;
  readonly at: number;
  readonly cause: EventId;
  /** Quitada por cirugía (antes de la gangrena), no por necrosis. */
  readonly surgical?: true;
}

/**
 * Partes amputadas por congelación, aparte del `Body` y de `FROSTBITE` (herida permanente de la
 * parte: no se cura ni se borra). Sin fila no hay pérdidas. La escribe `life.thermal`.
 */
export interface Amputations {
  readonly lost: readonly LostPart[];
}
export const AMPUTATIONS = table<Amputations>("body.amputations");

/** Multiplicadores de capacidad que dejan las partes perdidas (1 = sin pérdida). */
export interface AmputationFactors {
  readonly manipulation: number;
  readonly locomotion: number;
}

/** Sin manos queda una fracción de la manipulación; sin pies, de la locomoción. */
export function amputationFactors(a: Amputations | undefined): AmputationFactors {
  const has = (p: FrostbitePart) => a?.lost.some((l) => l.part === p) === true;
  return { manipulation: has("hands") ? 0.35 : 1, locomotion: has("feet") ? 0.4 : 1 };
}

/** Zonas del cuerpo y gravedad fija que deja cada parte perdida (sin calibrar). */
export const LOST_PART_ZONES: Readonly<
  Record<FrostbitePart, readonly { zone: string; severity: number }[]>
> = {
  hands: [
    { zone: "left_arm", severity: 0.65 },
    { zone: "right_arm", severity: 0.65 },
  ],
  feet: [
    { zone: "left_leg", severity: 0.6 },
    { zone: "right_leg", severity: 0.6 },
  ],
  face: [{ zone: "head", severity: 0.3 }],
};

/** Las marcas permanentes que faltan en `scars` por las partes perdidas (una por zona, una sola vez). */
export function amputationScars(a: Amputations | undefined, scars: readonly Scar[]): Scar[] {
  const out: Scar[] = [];
  for (const l of a?.lost ?? [])
    for (const z of LOST_PART_ZONES[l.part]) {
      if (scars.some((sc) => sc.lost && sc.zone === z.zone && sc.cause === l.cause)) continue;
      out.push({
        zone: z.zone,
        kind: "cut",
        severity: z.severity,
        at: l.at,
        cause: l.cause,
        lost: true,
      });
    }
  return out;
}

/** Partes que el estado dice necróticas y que todavía no están registradas como perdidas. */
export function newAmputations(
  state: FrostbiteState,
  had: Amputations | undefined,
): FrostbitePart[] {
  return frostbiteAmputations(state).filter((p) => !had?.lost.some((l) => l.part === p));
}

/**
 * Tratamiento en curso de la congelación, aparte del `Body` y de `FROSTBITE` (como `THERMAL`): lo
 * escribe quien atiende (un médico, uno mismo) y lo consume `life.thermal`. Sin fila no hay
 * tratamiento. `rewarm` e `insulate` (0-1, intensidad) rigen hasta `until`; `amputate` es la orden
 * de quitar quirúrgicamente esas partes, que se ejecuta una vez.
 */
export interface FrostbiteCareOrder {
  readonly rewarm: number;
  readonly insulate: number;
  readonly amputate: readonly FrostbitePart[];
  /** Hasta cuándo rigen recalentar y aislar. */
  readonly until: number;
  /** Quién atiende (lo que causa el evento). */
  readonly by?: string;
  readonly at: number;
}
export const FROSTBITE_CARE = table<FrostbiteCareOrder>("body.frostbite_care");
/**
 * Pedido de tratamiento que escribe el médico (`life.medicine`, único escritor); `life.thermal`
 * lo convierte en la orden de `FROSTBITE_CARE` (único escritor de esa) cuando es más nuevo que la
 * orden vigente. Misma forma que la orden.
 */
export const FROSTBITE_ORDERS = table<FrostbiteCareOrder>("body.frostbite_orders");

/** Baja de gravedad por hora con recalentamiento y con aislamiento (a intensidad 1), además de la curación natural. */
export const FROSTBITE_REWARM_PER_HOUR = 0.04;
export const FROSTBITE_INSULATE_PER_HOUR = 0.02;
/** Gravedad desde la que la cirugía tiene sentido (profunda o peor); antes se recalienta. */
export const FROSTBITE_SURGERY_MIN = 0.5;

/**
 * Un tratamiento de `hours` horas: recalentar y aislar bajan la gravedad por hora de lo que todavía
 * se puede salvar (lo necrosado no vuelve). Con `hours <= 0` o sin intensidad devuelve el mismo estado.
 */
export function treatFrostbite(
  state: FrostbiteState,
  care: Pick<FrostbiteCareOrder, "rewarm" | "insulate">,
  hours: number,
  now: number,
): FrostbiteState {
  const drop =
    (clamp(care.rewarm, 0, 1) * FROSTBITE_REWARM_PER_HOUR +
      clamp(care.insulate, 0, 1) * FROSTBITE_INSULATE_PER_HOUR) *
    hours;
  if (drop <= 0) return state;
  const next = (v: number) => (v >= FROSTBITE_AMPUTATION ? v : clamp(v - drop, 0, 1));
  return { hands: next(state.hands), feet: next(state.feet), face: next(state.face), at: now };
}

/**
 * Amputación quirúrgica de las partes pedidas que lo justifican (gravedad profunda o necrótica) y
 * que no estén ya perdidas: quita el tejido (gravedad 0) antes de que la gangrena se lleve más.
 * Devuelve el estado resultante y las partes quitadas.
 */
export function amputateSurgically(
  state: FrostbiteState,
  parts: readonly FrostbitePart[],
  had: Amputations | undefined,
  now: number,
): { readonly state: FrostbiteState; readonly done: FrostbitePart[] } {
  const done = FROSTBITE_PARTS.filter(
    (p) =>
      parts.includes(p) &&
      state[p] >= FROSTBITE_SURGERY_MIN &&
      !had?.lost.some((l) => l.part === p),
  );
  if (done.length === 0) return { state, done };
  const z = (p: FrostbitePart) => (done.includes(p) ? 0 : state[p]);
  return { state: { hands: z("hands"), feet: z("feet"), face: z("face"), at: now }, done };
}

/** Agua por hora (L) que suda en equilibrio, para alimentar la sed del cuerpo. */
export function sweatLitersPerHour(
  env: ThermalEnv,
  clothing: Clothing,
  activityKcal: number,
  massKg: number,
): number {
  return stepCore(CORE_NORMAL_C, massKg, env, clothing, activityKcal, 1, 1).sweatL;
}

/** Una prenda puesta: lo que aporta (propiedades del ítem). */
export interface Garment {
  readonly clo: number;
  readonly windproof: number;
  /** 0-1 del cuerpo que cubre. */
  readonly coverage: number;
}

/**
 * La ropa de quien lleva estas prendas: el aislamiento se suma, el cortaviento es el de la capa
 * que más frena y la cobertura combina áreas que se superponen (1 - producto de lo descubierto).
 * Sin prendas, desnudo.
 */
export function dressed(garments: readonly Garment[]): Clothing {
  if (garments.length === 0) return NAKED;
  let clo = 0;
  let windproof = 0;
  let uncovered = 1;
  for (const g of garments) {
    clo += Math.max(0, g.clo);
    windproof = Math.max(windproof, clamp(g.windproof, 0, 1));
    uncovered *= 1 - clamp(g.coverage, 0, 1);
  }
  return { clo, windproof, coverage: 1 - uncovered };
}

/** °C equivalentes que suman fuegos a distancia (m): caen con el cuadrado y se cortan lejos. */
export function fireRadiantC(fires: readonly { intensity: number; distanceM: number }[]): number {
  let total = 0;
  for (const f of fires) {
    const d = Math.max(1, f.distanceM);
    if (d > 12) continue;
    total += (clamp(f.intensity, 0, 1) * 25) / (d * d);
  }
  return clamp(total, 0, 30);
}

/**
 * Reparo (0-1) de un lugar por su construcción: con techo, las paredes y la puerta abierta o rala
 * (`openness`, 0 cerrado y 1 a cielo abierto) dejan pasar algo; sin techo, a lo sumo la mitad.
 */
export function shelterOf(roof: boolean, openness: number): number {
  const o = clamp(openness, 0, 1);
  return roof ? clamp(1 - 0.6 * o, 0.4, 1) : clamp(0.5 * (1 - o), 0, 0.5);
}

/** Material de las paredes: cuánto cierran (1 hermético, 0 nada). Marcador sin calibrar. */
export const WALL_TIGHTNESS = {
  cave: 1,
  stone: 0.95,
  wood: 0.85,
  hide: 0.7,
  paper: 0.5,
} as const;
export type WallMaterial = keyof typeof WALL_TIGHTNESS;

/** Lo que de un espacio importa al reparo: techo, apertura (puerta/hueco) y material de paredes. */
export interface ShelterAttrs {
  readonly roof: boolean;
  /** 0 cerrado y 1 a cielo abierto (puerta abierta o hueco grande). */
  readonly openness: number;
  readonly wall?: WallMaterial;
}

/**
 * Reparo (0-1) de un espacio: la apertura efectiva suma lo que dejan pasar las paredes según
 * el material (`WALL_TIGHTNESS`; sin dato, hermético) y sale de `shelterOf`.
 */
export function shelterOfSpace(a: ShelterAttrs): number {
  const tight = a.wall === undefined ? 1 : WALL_TIGHTNESS[a.wall];
  const open = clamp(a.openness, 0, 1);
  return shelterOf(a.roof, 1 - (1 - open) * tight);
}

/**
 * Las capacidades con el núcleo frío o caliente: el entumecimiento y el mareo bajan manipulación y
 * locomoción con `dexterityFactor`, y con `thermalUnconscious` no queda ninguna (body-health §7).
 * Con el núcleo normal devuelve las mismas.
 */
export function applyCore(caps: BodyCapabilities, coreC: number): BodyCapabilities {
  if (thermalUnconscious(coreC)) {
    return {
      ...caps,
      locomotion: 0,
      manipulation: 0,
      speech: 0,
      strength: 0,
      cognition: 0,
      endurance: 0,
      sight: 0,
      hearing: 0,
    };
  }
  const f = dexterityFactor(coreC);
  if (f >= 1) return caps;
  return { ...caps, manipulation: caps.manipulation * f, locomotion: caps.locomotion * f };
}
