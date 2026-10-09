// Sustancias, venenos y adicciones (body-health §9), parte pura: una sustancia entra por una vía
// (ingerida, inhalada, sangre, piel) a un depósito, pasa a la sangre con la absorción de la vía, se
// metaboliza con su vida media, y su efecto sale de una curva de dosis-respuesta que la tolerancia
// desplaza. Un veneno daña con latencia (el sitio de acción sigue a la sangre con retraso) hasta que
// el daño acumulado mata. El uso repetido sube tolerancia y dependencia; sin la sustancia aparece
// abstinencia. Sin IO ni estado del mundo: el cableado a `Body` y a la vida queda aparte.
// Constantes sin calibrar. Todo en horas y en dosis (unidades de la sustancia).

import { pow } from "../../core/math/index.ts";

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

export type SubstanceRoute = "ingest" | "inhale" | "blood" | "skin";

/** Cómo entra por una vía: qué fracción se absorbe y qué tan rápido (vida media del depósito, en horas). */
export interface RouteAbsorption {
  /** 0-1: fracción de la dosis que llega a la sangre (el resto se pierde). */
  readonly bioavailability: number;
  /** Horas en pasar la mitad del depósito a la sangre. */
  readonly halfHours: number;
}

export interface DependenceDef {
  /** 0-1: cuánta dependencia suma cada uso (antes de saturar). */
  readonly potential: number;
  /** 0-1: cuánta tolerancia suma cada uso (antes de saturar). */
  readonly tolerancePerUse: number;
  /** Horas sin sustancia hasta que empieza la abstinencia. */
  readonly withdrawalOnsetHours: number;
  /** Horas desde el inicio hasta la abstinencia máxima. */
  readonly withdrawalPeakHours: number;
  /** Días para que la tolerancia y la dependencia bajen a la mitad sin uso. */
  readonly recoveryHalfDays: number;
}

export interface SubstanceDef {
  readonly id: string;
  /** Solo las vías listadas funcionan; otra vía no hace nada. */
  readonly routes: Partial<Record<SubstanceRoute, RouteAbsorption>>;
  /** Vida media en sangre (horas). */
  readonly halfLifeHours: number;
  /** Nivel en sangre que da la mitad del efecto máximo (sin tolerancia). */
  readonly ec50: number;
  /** Pendiente de la curva dosis-respuesta (>1: más abrupta). */
  readonly hill: number;
  /** Horas que tarda el sitio de acción del daño en seguir a la sangre. */
  readonly latencyHours: number;
  /** Nivel en el sitio de acción desde el que hay daño (0 o Infinity: inocua). */
  readonly toxicThreshold: number;
  /** Daño (0-1 del total letal) por hora cuando el sitio de acción está al doble del umbral. */
  readonly damagePerHourAtDouble: number;
  /** Horas para que el daño acumulado se repare a la mitad (cuando ya no hay exceso). */
  readonly repairHalfHours: number;
  readonly dependence?: DependenceDef;
  /** Efectos agudos sobre capacidades y dolor (sin esto la sustancia no baja nada). */
  readonly acute?: AcuteDef;
}

type AcuteCap =
  | "locomotion"
  | "manipulation"
  | "speech"
  | "strength"
  | "cognition"
  | "endurance"
  | "sight"
  | "hearing";

export interface AcuteDef {
  /** Pérdida (0-1) de cada capacidad con `effectLevel` 1. */
  readonly impairs?: Readonly<Partial<Record<AcuteCap, number>>>;
  /** Fracción del dolor que se deja de sentir con `effectLevel` 1. */
  readonly numbs?: number;
  /** Pérdida (0-1) de cada capacidad con abstinencia 1 (manos que tiemblan, mente nublada). */
  readonly withdrawalImpairs?: Readonly<Partial<Record<AcuteCap, number>>>;
}

export interface SubstanceState {
  /** Dosis sin absorber, por vía. */
  readonly depot: Readonly<Partial<Record<SubstanceRoute, number>>>;
  /** Nivel en sangre. */
  readonly blood: number;
  /** Nivel en el sitio de acción del daño (sigue a la sangre con retraso). */
  readonly site: number;
  /** Daño acumulado, 0-1: a 1 se muere. */
  readonly damage: number;
  /** 0-1: cuánto hay que subir la dosis para el mismo efecto. */
  readonly tolerance: number;
  /** 0-1: dependencia física. */
  readonly dependence: number;
  /** Horas desde la última dosis (Infinity si nunca). */
  readonly hoursSinceUse: number;
}

export const CLEAN: SubstanceState = {
  depot: {},
  blood: 0,
  site: 0,
  damage: 0,
  tolerance: 0,
  dependence: 0,
  hoursSinceUse: Number.POSITIVE_INFINITY,
};

/** Factor de decaimiento exponencial tras `hours` con vida media `half`. */
function decay(hours: number, half: number): number {
  if (!(half > 0)) return 0;
  return pow(0.5, hours / half);
}

/** Toma una dosis por una vía: va al depósito (con la biodisponibilidad) y cuenta como uso. */
export function dose(
  def: SubstanceDef,
  state: SubstanceState,
  route: SubstanceRoute,
  amount: number,
): SubstanceState {
  const abs = def.routes[route];
  if (!abs || amount <= 0) return state;
  const dep = def.dependence;
  return {
    ...state,
    depot: { ...state.depot, [route]: (state.depot[route] ?? 0) + amount * abs.bioavailability },
    tolerance: dep
      ? state.tolerance + (1 - state.tolerance) * dep.tolerancePerUse
      : state.tolerance,
    dependence: dep ? state.dependence + (1 - state.dependence) * dep.potential : state.dependence,
    hoursSinceUse: 0,
  };
}

/**
 * Avanza `hours` horas (conviene pasos de una hora o menos): el depósito pasa a la sangre, la
 * sangre se metaboliza, el sitio de acción la sigue con latencia, el daño se acumula sobre el
 * umbral y se repara debajo, y tolerancia y dependencia se recuperan con los días sin uso.
 */
export function stepSubstance(
  def: SubstanceDef,
  state: SubstanceState,
  hours: number,
): SubstanceState {
  if (hours <= 0) return state;
  const depot: Partial<Record<SubstanceRoute, number>> = {};
  let moved = 0;
  for (const route of Object.keys(state.depot) as SubstanceRoute[]) {
    const amount = state.depot[route] ?? 0;
    const abs = def.routes[route];
    if (!abs || amount <= 0) continue;
    const left = amount * decay(hours, abs.halfHours);
    moved += amount - left;
    if (left > 1e-9) depot[route] = left;
  }
  // La sangre recibe lo absorbido (la mitad del tramo ya se metabolizó, aproximado) y se limpia.
  const blood0 =
    state.blood * decay(hours, def.halfLifeHours) + moved * decay(hours / 2, def.halfLifeHours);
  const blood = blood0 > 1e-9 ? blood0 : 0;
  // El sitio de acción se acerca a la sangre con la latencia como vida media.
  const k = 1 - decay(hours, def.latencyHours);
  const site0 = state.site + (blood - state.site) * (def.latencyHours > 0 ? k : 1);
  const site = site0 > 1e-9 ? site0 : 0;

  let damage = state.damage;
  const thr = def.toxicThreshold;
  if (Number.isFinite(thr) && thr > 0 && site > thr) {
    const over = (site - thr) / thr; // 1 = al doble del umbral
    damage += def.damagePerHourAtDouble * over * hours;
  } else {
    damage *= decay(hours, def.repairHalfHours);
  }

  const dep = def.dependence;
  const rec = dep ? decay(hours / 24, dep.recoveryHalfDays) : 1;
  // Mientras haya sustancia en sangre la dependencia y la tolerancia no se recuperan.
  const present = blood > def.ec50 * 0.05;
  return {
    depot,
    blood,
    site,
    damage: clamp(damage, 0, 1),
    tolerance: present ? state.tolerance : state.tolerance * rec,
    dependence: present ? state.dependence : state.dependence * rec,
    hoursSinceUse: state.hoursSinceUse + hours,
  };
}

/** 0-1: intensidad del efecto buscado (euforia, analgesia, sueño): Hill sobre el nivel con tolerancia. */
export function effectLevel(def: SubstanceDef, state: SubstanceState): number {
  if (state.blood <= 0) return 0;
  const ec = def.ec50 * (1 + 4 * state.tolerance);
  const x = pow(state.blood, def.hill);
  return x / (x + pow(ec, def.hill));
}

/**
 * 0-1: gravedad de la abstinencia. Sube desde `withdrawalOnsetHours` sin uso hasta el pico y se
 * escala con la dependencia; con la sustancia en sangre no hay.
 */
export function withdrawalSeverity(def: SubstanceDef, state: SubstanceState): number {
  const dep = def.dependence;
  if (!dep || state.dependence <= 0) return 0;
  if (state.blood > def.ec50 * 0.05) return 0;
  const since = state.hoursSinceUse - dep.withdrawalOnsetHours;
  if (since <= 0) return 0;
  const ramp = clamp(since / Math.max(1, dep.withdrawalPeakHours), 0, 1);
  return clamp(state.dependence * ramp, 0, 1);
}

/** 0-1: cuánto el cuerpo reclama la dosis (ansia): sube con la abstinencia y con la dependencia en reposo. */
export function craving(def: SubstanceDef, state: SubstanceState): number {
  const dep = def.dependence;
  if (!dep) return 0;
  return clamp(withdrawalSeverity(def, state) + 0.25 * state.dependence, 0, 1);
}

export type SubstanceStage = "none" | "symptoms" | "grave" | "dying";

/** Etapa visible de un envenenamiento por el daño acumulado (lo que un médico podría ver). */
export function poisonStage(state: SubstanceState): SubstanceStage {
  if (state.damage >= 0.85) return "dying";
  if (state.damage >= 0.4) return "grave";
  if (state.damage >= 0.05) return "symptoms";
  return "none";
}

/** Muere por la sustancia cuando el daño acumulado llega al total. */
export function substanceDeath(state: SubstanceState): boolean {
  return state.damage >= 1;
}

/** Dosis ingerida que lleva el nivel en sangre al umbral tóxico (para fijar letalidad al diseñar). */
export function thresholdDose(def: SubstanceDef, route: SubstanceRoute): number {
  const abs = def.routes[route];
  if (!abs || !Number.isFinite(def.toxicThreshold)) return Number.POSITIVE_INFINITY;
  return def.toxicThreshold / abs.bioavailability;
}
