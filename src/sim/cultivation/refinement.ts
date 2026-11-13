// El cuerpo templado por el cultivo (novel3-refined-core, cultivation §1, combat §10): cada umbral
// cruzado deja el cuerpo más rápido, más duro, con más aire y más fuerza. Es lo que hace que un
// cultivador de pocos tramos le gane a varios mortales y que uno alto ni se despeine. La forma tiene
// la de `FighterRefinement` en `sim/combat`, que la usa sin importar este módulo. Constantes sin
// calibrar; la ley todavía no tiene efectos corporales por umbral, así que salen del tramo.
//
// Puro.

/** Cuánto más rápido por umbral cruzado. */
export const REFINE_SPEED = 0.25;
/** Cuánto de la fuerza de un golpe deja de herir por umbral, hasta `REFINE_HARDNESS_MAX`. */
export const REFINE_HARDNESS = 0.12;
export const REFINE_HARDNESS_MAX = 0.8;
/** Cuánto más rinde el aire por umbral. */
export const REFINE_ENDURANCE = 0.3;
/** Cuánto más pega por umbral. */
export const REFINE_MIGHT = 0.2;

export interface Refinement {
  readonly speed: number;
  readonly hardness: number;
  readonly endurance: number;
  readonly might: number;
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** El cuerpo de quien cruzó `stage` umbrales; con 0 (o sin cultivo), el de un mortal. */
export function refinementOf(stage: number): Refinement {
  const n = Math.max(0, Math.floor(stage));
  return {
    speed: round3(1 + REFINE_SPEED * n),
    hardness: round3(Math.min(REFINE_HARDNESS_MAX, REFINE_HARDNESS * n)),
    endurance: round3(1 + REFINE_ENDURANCE * n),
    might: round3(1 + REFINE_MIGHT * n),
  };
}
