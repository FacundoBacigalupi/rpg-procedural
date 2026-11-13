// El pabellón de escrituras de la sede (novel2-method-pavilion, cultivation §8): la secta da el
// método del reino siguiente al que es de ella y ya llegó a la cima del que su método cubre (antes
// no lo enseña: no lo podría practicar). Lo paga con puntos de contribución, o se lo da su rango.
// La regla es pura: qué método toca, cuánto cuesta o por qué no.

import type { MemberRank } from "./member.ts";
import { type KnownTechnique, realmIndex, type School, type SchoolMethod } from "./school.ts";

/** Cuántos puntos pide la secta por reino del método (el del segundo reino, uno; sin calibrar). */
export const METHOD_POINTS_PER_REALM = 60;

/** Hasta qué reino da el método un rango sin cobrar (el del segundo reino, a los internos). */
export const METHOD_FREE_REALM: Readonly<Record<MemberRank, number>> = {
  outer: 0,
  inner: 1,
  core: 2,
  elder: 99,
  master: 99,
};

/** Por qué el pabellón no da el método. */
export type MethodRefusal = "not_member" | "no_method" | "too_soon" | "no_points";

export type MethodExchange =
  | { readonly kind: "given"; readonly method: SchoolMethod; readonly cost: number }
  | { readonly kind: "refused"; readonly refused: MethodRefusal; readonly realm?: number };

/**
 * El método que da el pabellón a quien sabe `known` (o ninguno), está en el tramo `stage`, tiene
 * `rank` y `points`: el del reino que sigue al suyo, si ya está en la cima (romper lo lleva más
 * allá de lo que cubre) y si lo paga o su rango alcanza.
 */
export function methodExchange(
  school: School,
  known: KnownTechnique | undefined,
  rank: MemberRank,
  stage: number,
  points: number,
): MethodExchange {
  const have = known ? (known.realm ?? 0) : -1;
  const realm = have + 1;
  const method = school.methods?.[realm];
  if (!method) return { kind: "refused", refused: "no_method" };
  // Solo cuando el paso que sigue cae afuera de lo que sabe (sin método, el de entrada siempre).
  if (realm > 0 && realmIndex(school, stage + 1) < realm)
    return { kind: "refused", refused: "too_soon", realm };
  const cost = realm <= METHOD_FREE_REALM[rank] ? 0 : METHOD_POINTS_PER_REALM * realm;
  if (cost > points) return { kind: "refused", refused: "no_points", realm };
  return { kind: "given", method, cost };
}
