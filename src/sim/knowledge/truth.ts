// Creer contra saber (information §10; tooling `wrong`): compara una creencia con la verdad. Es solo
// para el inspector, las pruebas y la crónica: ninguna decisión del mundo lee esto.

import { ENTITY, LOCATION, type ReadonlyWorldTruth } from "../world/index.ts";
import { type Belief, sameValue } from "./belief.ts";

/** Lo que es verdad hoy de la proposición de `b`. */
export function truthOf(
  truth: ReadonlyWorldTruth,
  b: Belief,
): boolean | { hex: number; space?: string } | undefined {
  if (b.prop.attr === "alive") return truth.get(ENTITY, b.prop.subject)?.endedAt === undefined;
  return truth.get(LOCATION, b.prop.subject);
}

/** ¿Lo que cree difiere de lo que hoy es cierto? (Una creencia vieja y acertada no cuenta.) */
export function isMistaken(truth: ReadonlyWorldTruth, b: Belief): boolean {
  const real = truthOf(truth, b);
  if (real === undefined) return true;
  return !sameValue(b.value, real);
}
