// Epidemias y evolución (body-health §6, parte pura): un patógeno viaja porque alguien lo lleva
// (un portador en una caravana introduce dosis en el destino), se sostiene en reservorios
// (animales, aguas), muta en hijos con `ancestor` y linaje, y golpea más fuerte a poblaciones sin
// historia de exposición. Sin estado global ni azar implícito: cada parámetro que muta sale de un
// `fork` del `Rng` que pasa el llamador.

import { exp, pow, type Rng } from "../../core/index.ts";
import {
  exposureDose,
  type Immunity,
  infectionStage,
  type PathogenDef,
  type Shared,
  sheddingLevel,
} from "./disease.ts";

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

// --- portadores en movimiento ----------------------------------------------------------------

/** Quien lleva el patógeno por un camino: expuesto hace `hoursSinceExposure` horas. */
export interface Carrier {
  readonly pathogen: PathogenDef;
  readonly hoursSinceExposure: number;
  readonly fatal: boolean;
  /** Origen del viaje (para atribuir la peste a una caravana concreta). */
  readonly from: string;
  readonly party: number;
}

export interface ArrivalOutcome {
  /** Murió en el camino (el patógeno no llega con él). */
  readonly diedOnRoad: boolean;
  /** Cuánto excreta al llegar (0-1). */
  readonly shedding: number;
  /** Dosis que introduce en el destino con ese trato (cero si no llega contagioso). */
  readonly dose: number;
}

/** Qué trae un portador tras `travelHours` de camino y cuánta dosis deja en el destino. */
export function carrierArrival(
  c: Carrier,
  travelHours: number,
  atDestination: Shared,
): ArrivalOutcome {
  const total = c.hoursSinceExposure + travelHours;
  const inf = { pathogen: c.pathogen.id, exposedAt: 0, dose: 1, fatal: c.fatal, cause: null };
  const stage = infectionStage(c.pathogen, inf, total);
  if (stage === "dead") return { diedOnRoad: true, shedding: 0, dose: 0 };
  const shedding = sheddingLevel(c.pathogen, stage, total);
  return {
    diedOnRoad: false,
    shedding,
    dose: exposureDose(c.pathogen, shedding, atDestination) * Math.max(1, c.party),
  };
}

// --- reservorios -----------------------------------------------------------------------------

/** Una población (ratas, mosquitos, una bestia, el agua de un pantano) que guarda el patógeno. */
export interface Reservoir {
  readonly pathogen: string;
  readonly kind: "animal" | "water";
  readonly population: number;
  /** 0-1: fracción infectada o carga del agua. */
  readonly prevalence: number;
  /** Población mínima para que se sostenga sola (tamaño crítico). */
  readonly criticalSize: number;
}

/** Prevalencia tras `days` días: se sostiene sobre el tamaño crítico y se apaga bajo él. */
export function reservoirStep(r: Reservoir, days: number): Reservoir {
  const ratio = r.population / Math.max(1, r.criticalSize);
  const target = ratio >= 1 ? clamp(0.1 + 0.2 * (1 - 1 / ratio), 0, 0.5) : 0;
  const k = 1 - exp(-days / 20);
  let prevalence = r.prevalence + (target - r.prevalence) * k;
  if (prevalence < 0.005) prevalence = 0;
  return { ...r, prevalence };
}

/** Dosis que el reservorio derrama a un grupo con ese contacto (0-1: cazan, beben, conviven). */
export function reservoirSpill(
  r: Reservoir,
  p: PathogenDef,
  contact: number,
  days: number,
): number {
  const route = (p.routes.contact ?? 0) + (p.routes.water ?? 0);
  return r.prevalence * clamp(contact, 0, 1) * route * days;
}

// --- mutación y linaje -----------------------------------------------------------------------

export interface PathogenLineageEntry {
  readonly id: string;
  readonly ancestor: string | null;
}

export interface MutantRecord {
  readonly def: PathogenDef;
  readonly ancestor: string;
  /** Qué parámetros cambiaron y de cuánto a cuánto (para el inspector). */
  readonly changes: readonly {
    readonly param: string;
    readonly from: number;
    readonly to: number;
  }[];
}

type Mutable =
  | "transmissibility"
  | "lethality"
  | "incubationHours"
  | "courseHours"
  | "contagiousFrom";
const MUTABLE: readonly Mutable[] = [
  "transmissibility",
  "lethality",
  "incubationHours",
  "courseHours",
  "contagiousFrom",
];

/**
 * Hijo del patógeno con parámetros perturbados. Cada parámetro tiene su propio flujo
 * (`rng.fork(param)`), así agregar uno no corre los otros. Compromiso: lo que gana en contagio
 * tiende a perder en letalidad. `strength` es el desvío relativo (0.1 = 10%).
 */
export function mutate(
  parent: PathogenDef,
  childId: string,
  rng: Rng,
  strength = 0.1,
): MutantRecord {
  const sd = strength * Math.LOG2E; // desvío en octavas (log2)
  const next = {} as Record<Mutable, number>;
  for (const param of MUTABLE) next[param] = parent[param] * pow(2, rng.fork(param).normal(0, sd));
  const tGain = next.transmissibility / parent.transmissibility;
  if (tGain > 1) next.lethality = next.lethality / pow(tGain, 0.5);
  next.lethality = clamp(next.lethality, 0, 1);
  next.contagiousFrom = clamp(next.contagiousFrom, 0, 1);
  const changes: { param: string; from: number; to: number }[] = [];
  for (const param of MUTABLE) {
    if (next[param] !== parent[param])
      changes.push({ param, from: parent[param], to: next[param] });
  }
  // Una ruta nueva aparece rara vez y débil; las existentes se perturban.
  const routes: Partial<Record<"contact" | "air" | "water", number>> = { ...parent.routes };
  const rr = rng.fork("routes");
  for (const route of ["contact", "air", "water"] as const) {
    const cur = routes[route] ?? 0;
    const sub = rr.fork(route);
    if (cur > 0) routes[route] = clamp(cur * pow(2, sub.normal(0, sd)), 0.01, 1);
    else if (sub.chance(strength * 0.1)) routes[route] = 0.1;
  }
  return { def: { ...parent, ...next, id: childId, routes }, ancestor: parent.id, changes };
}

/** Cuántas mutaciones surgen en `days` días con `infected` infectados (más gente, más copias). */
export function mutationCount(
  infected: number,
  days: number,
  ratePerInfectedDay: number,
  rng: Rng,
): number {
  return rng.poisson(Math.max(0, infected) * days * ratePerInfectedDay);
}

/** Cadena de ancestros de `id` (el propio primero), sin ciclos aunque los datos los tengan. */
export function pathogenLineage(entries: readonly PathogenLineageEntry[], id: string): string[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const out: string[] = [];
  let cur: string | null = id;
  while (cur !== null && !out.includes(cur)) {
    out.push(cur);
    cur = byId.get(cur)?.ancestor ?? null;
  }
  return out;
}

// --- poblaciones aisladas --------------------------------------------------------------------

/**
 * Protección cruzada (0-1) de quien tiene esa historia: 1 si pasó exactamente este patógeno, y
 * decae `perStep` por cada paso de linaje con uno que sí pasó (`ancestors`: la cadena de
 * `pathogenLineage`, propio primero; `descendants`: sus hijos en orden de cercanía).
 */
export function crossImmunity(
  ancestors: readonly string[],
  descendants: readonly string[],
  history: readonly Immunity[],
  now: number,
  perStep = 0.5,
): number {
  let best = 0;
  for (const h of history) {
    if (h.until !== null && now >= h.until) continue;
    const up = ancestors.indexOf(h.pathogen);
    const down = descendants.indexOf(h.pathogen);
    const steps = up >= 0 ? up : down >= 0 ? down + 1 : -1;
    if (steps >= 0) best = Math.max(best, pow(perStep, steps));
  }
  return best;
}

/**
 * Letalidad con esa protección cruzada: sin exposición previa (0) pega hasta `1 + naiveBoost`
 * veces más fuerte; con protección plena queda por debajo de la base.
 */
export function naiveLethality(p: PathogenDef, cross: number, naiveBoost = 2): number {
  const c = clamp(cross, 0, 1);
  return clamp(p.lethality * (1 + naiveBoost * (1 - c)) * (1 - 0.5 * c), 0, 1);
}

/**
 * Choque de poblaciones: al abrirse una ruta, una población aislada se infecta con la chance de
 * dosis sin inmunidad y muere con la letalidad sin historia. Devuelve enfermos y muertos.
 */
export function isolationShock(
  p: PathogenDef,
  population: number,
  dose: number,
  cross: number,
  rng: Rng,
): { readonly infected: number; readonly deaths: number } {
  const chance = 1 - exp(-p.transmissibility * dose * (1 - clamp(cross, 0, 0.95)));
  const infected = rng.fork("infected").binomial(population, clamp(chance, 0, 1));
  const deaths = rng.fork("deaths").binomial(infected, naiveLethality(p, cross));
  return { infected, deaths };
}
