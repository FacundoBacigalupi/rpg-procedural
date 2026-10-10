// Enfermedades infecciosas con contagio (body-health §6, parte pura): un patógeno con rutas de
// transmisión (contacto, aire, agua), incubación, curso e inmunidad; la dosis que recibe quien
// comparte espacio con un contagioso, la chance de infectarse (transmisibilidad × dosis × lo que
// frena la inmunidad y el sistema inmune) y el desenlace del curso. Sin estado global: lo que
// hace falta se pasa por argumento y el azar sale de un `Rng` con clave que pone el llamador.

import { exp, type Rng, type Tick } from "../../core/index.ts";

export const TRANSMISSION_ROUTES = ["contact", "air", "water"] as const;
export type TransmissionRoute = (typeof TRANSMISSION_ROUTES)[number];

export type ImmunityKind = "lifelong" | "waning" | "none";

export interface PathogenDef {
  readonly id: string;
  /** Rutas por las que pasa y cuánto cuenta cada una (0-1). */
  readonly routes: Readonly<Partial<Record<TransmissionRoute, number>>>;
  /** Horas desde la exposición hasta los síntomas. */
  readonly incubationHours: number;
  /** Horas de la enfermedad con síntomas. */
  readonly courseHours: number;
  /** Desde qué fracción de la incubación ya contagia (0-1; 1: solo con síntomas). */
  readonly contagiousFrom: number;
  /** Por dosis unitaria: qué tan fácil prende. */
  readonly transmissibility: number;
  /** 0-1: probabilidad de morir de un huésped promedio. */
  readonly lethality: number;
  readonly immunity: ImmunityKind;
  /** Horas que dura la inmunidad si es `waning`. */
  readonly immunityHours: number;
}

export type InfectionStage = "incubating" | "symptomatic" | "recovered" | "dead";

export interface Infection {
  readonly pathogen: string;
  readonly exposedAt: Tick;
  /** La dosis con que prendió (más dosis, más grave en el futuro). */
  readonly dose: number;
  /** Fijado al infectarse: si el curso termina en muerte (se tira una vez, con clave). */
  readonly fatal: boolean;
  /** El evento que contagió (el contacto) o null si viene de afuera. */
  readonly cause: string | null;
}

export interface Immunity {
  readonly pathogen: string;
  /** Hasta cuándo protege; `null` es de por vida. */
  readonly until: Tick | null;
}

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/** Etapa de la infección a la hora `hours` desde la exposición. */
export function infectionStage(
  p: PathogenDef,
  inf: Infection,
  hoursSinceExposure: number,
): InfectionStage {
  if (hoursSinceExposure < p.incubationHours) return "incubating";
  if (hoursSinceExposure < p.incubationHours + p.courseHours) return "symptomatic";
  return inf.fatal ? "dead" : "recovered";
}

/** Cuánto contagia ahora (0-1): sube durante la incubación tardía y es plena con síntomas. */
export function sheddingLevel(p: PathogenDef, stage: InfectionStage, hoursSince: number): number {
  if (stage === "symptomatic") return 1;
  if (stage !== "incubating") return 0;
  const frac = hoursSince / p.incubationHours;
  if (frac < p.contagiousFrom) return 0;
  return 0.3 * clamp((frac - p.contagiousFrom) / Math.max(1e-6, 1 - p.contagiousFrom), 0, 1);
}

/** Lo que comparten dos personas en un rato: cercanía y ventilación (0-1 cada una). */
export interface Shared {
  readonly hours: number;
  /** 1: abrazados; 0: lejos. */
  readonly closeness: number;
  /** 1: aire libre; 0: cuarto cerrado. */
  readonly ventilation: number;
  /** El agua que comparten está sucia (0-1). */
  readonly waterDirt: number;
  /** Tocan las mismas cosas o se tocan entre sí (0-1). */
  readonly touch: number;
}

/** Dosis recibida por un expuesto de un contagioso con ese nivel de excreción. */
export function exposureDose(p: PathogenDef, shedding: number, shared: Shared): number {
  if (shedding <= 0 || shared.hours <= 0) return 0;
  const air = (p.routes.air ?? 0) * shared.closeness * (1 - 0.8 * shared.ventilation);
  const contact = (p.routes.contact ?? 0) * shared.touch;
  const water = (p.routes.water ?? 0) * shared.waterDirt;
  return shedding * shared.hours * (air + contact + water);
}

/** Chance de infectarse con esa dosis: 1 - exp(-t × dosis × (1 - inmune)); `immune` es 0-1. */
export function infectionChance(
  p: PathogenDef,
  dose: number,
  immune: number,
  susceptibility = 1,
): number {
  if (dose <= 0) return 0;
  return 1 - exp(-p.transmissibility * dose * (1 - clamp(immune, 0, 0.95)) * susceptibility);
}

/** Susceptibilidad por defensa inmune debilitada (`DeficiencyEffects.immune`): 1 = normal, tope 10x. */
export function immuneSusceptibility(immune: number): number {
  return 1 / Math.max(immune, 0.1);
}

/** ¿Protege la inmunidad guardada contra este patógeno en `now`? */
export function isImmune(imm: readonly Immunity[], pathogen: string, now: Tick): boolean {
  return imm.some((i) => i.pathogen === pathogen && (i.until === null || now < i.until));
}

/** La inmunidad que deja haber pasado la enfermedad (null si no deja). */
export function immunityAfter(p: PathogenDef, ticksPerHour: number, now: Tick): Immunity | null {
  if (p.immunity === "none") return null;
  if (p.immunity === "lifelong") return { pathogen: p.id, until: null };
  return { pathogen: p.id, until: now + Math.round(p.immunityHours * ticksPerHour) };
}

/**
 * Tira la exposición de un expuesto a una dosis. `rng` es la clave del par (expuesto, fuente, día):
 * misma clave, mismo resultado. Devuelve la infección o null.
 */
export function tryInfect(
  p: PathogenDef,
  dose: number,
  immuneScore: number,
  frailty: number,
  rng: Rng,
  at: Tick,
  cause: string | null,
  susceptibility = 1,
): Infection | null {
  if (!rng.chance(infectionChance(p, dose, immuneScore, susceptibility))) return null;
  const fatal = rng.chance(clamp(p.lethality * (0.5 + frailty), 0, 1));
  return { pathogen: p.id, exposedAt: at, dose, fatal, cause };
}
