// Sustancias como entidades y estado por persona (body-health §9), cableado. Una sustancia concreta
// existe porque algo la trajo (`originEventId` en su ficha, como el patógeno) y lleva su definición;
// lo que cada persona tiene en el cuerpo vive en `PERSON_SUBSTANCE`, aparte del `Body`, y solo
// mientras queda algo (dosis, nivel, daño, tolerancia o dependencia).

import { table } from "../world/index.ts";
import type { SubstanceDef, SubstanceState } from "./substance.ts";
import type { CravingCue } from "./substance-cues.ts";

export interface SubstanceRecord {
  readonly def: SubstanceDef;
  /** Qué la trajo, en palabras (una planta, una receta, un escenario). */
  readonly source: string;
}

export const SUBSTANCE = table<SubstanceRecord>("body.substance_kind");

/** Lo que una persona tiene de una sustancia (`hoursSinceUse` siempre finito: se guarda tras una dosis). */
export interface HeldSubstance {
  readonly substance: string;
  readonly state: SubstanceState;
}

export interface PersonSubstances {
  readonly held: readonly HeldSubstance[];
  /** Hasta cuándo está calculado. */
  readonly at: number;
  /** Señales de ansia aprendidas (opt-in `cravingCues`); ausente, no hay condicionamiento. */
  readonly cues?: readonly CravingCue[];
}

/** Clave: la persona. Sin fila, no hay nada en el cuerpo. */
export const PERSON_SUBSTANCE = table<PersonSubstances>("body.substance");
