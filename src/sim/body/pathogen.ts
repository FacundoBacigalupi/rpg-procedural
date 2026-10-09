// Patógenos como entidades y pozos contaminados (body-health §6): un patógeno concreto existe
// porque algo lo trajo (`originEventId` en su ficha) y lleva su definición; el agua de un pozo
// guarda la carga que le cayó, que baja con el tiempo. Nada nace solo: el llamador siembra por
// una fuente explícita.

import { exp, type Tick } from "../../core/index.ts";
import { table } from "../world/index.ts";
import type { Immunity, Infection, PathogenDef } from "./disease.ts";

export interface PathogenRecord {
  readonly def: PathogenDef;
  /** Qué lo trajo, en palabras de la fuente (una caravana, un reservorio, un escenario). */
  readonly source: string;
}

export const PATHOGEN = table<PathogenRecord>("body.pathogen");

/** La carga de patógeno en el agua de un pozo (clave: el `WorkId`). */
export interface WellTaint {
  readonly pathogen: string;
  /** 0-1: qué tan sucia está el agua. */
  readonly load: number;
  readonly since: Tick;
  /** El evento que la ensució. */
  readonly cause: string;
}

export const WELL_TAINT = table<WellTaint>("body.well_taint");

/** Cuánto de la carga queda tras `days` días (se diluye y se asienta; calibración abierta). */
export function taintAfter(load: number, days: number): number {
  const left = load * exp((-Math.LN2 * days) / 5);
  return left < 0.01 ? 0 : left;
}

/** Lo contagioso de una persona: infecciones en curso, inmunidad y qué síntomas tiene ahora. */
export interface PersonInfection {
  readonly infections: readonly Infection[];
  readonly immunities: readonly Immunity[];
  /** Patógenos con síntomas hoy (lo que `bodySigns` muestra como fiebre). */
  readonly ill: readonly string[];
}

/** Aparte del `Body` para que el proceso de contagio y el del cuerpo no pisen el mismo componente. */
export const INFECTION = table<PersonInfection>("body.infection");
