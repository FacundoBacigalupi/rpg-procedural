// Creer contra saber (information §10; tooling `wrong`): compara una creencia con la verdad. Es solo
// para el inspector, las pruebas y la crónica: ninguna decisión del mundo lee esto.

import type { Tick } from "../../core/index.ts";
import { ENTITY, LOCATION, type ReadonlyWorldTruth } from "../world/index.ts";
import { BELIEFS, type Belief, beliefConfidenceAt, sameValue } from "./belief.ts";

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

export interface BeliefAccuracy {
  /** Personas con al menos una creencia. */
  readonly holders: number;
  readonly beliefs: number;
  readonly mistaken: number;
  /** Creencias falsas sobre creencias totales (0 si no hay). */
  readonly mistakenShare: number;
  /** Confianza media (envejecida) de las creencias acertadas y de las falsas. */
  readonly meanConfidenceRight: number;
  readonly meanConfidenceWrong: number;
  /** Cuántas falsas siguen con confianza de 0.5 o más: el error del que no duda. */
  readonly confidentlyWrong: number;
}

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

/** Exactitud de las creencias de todos al momento `now` (tooling §6): solo lectura, para métricas. */
export function beliefAccuracy(truth: ReadonlyWorldTruth, now: Tick): BeliefAccuracy {
  let holders = 0;
  let beliefs = 0;
  let mistaken = 0;
  let confidentlyWrong = 0;
  let sumRight = 0;
  let sumWrong = 0;
  for (const id of truth.ids(BELIEFS)) {
    const items = truth.get(BELIEFS, id)?.items ?? [];
    if (items.length === 0) continue;
    holders++;
    for (const b of items) {
      beliefs++;
      const c = beliefConfidenceAt(b, now);
      if (isMistaken(truth, b)) {
        mistaken++;
        sumWrong += c;
        if (c >= 0.5) confidentlyWrong++;
      } else sumRight += c;
    }
  }
  const right = beliefs - mistaken;
  return {
    holders,
    beliefs,
    mistaken,
    mistakenShare: beliefs === 0 ? 0 : r6(mistaken / beliefs),
    meanConfidenceRight: right === 0 ? 0 : r6(sumRight / right),
    meanConfidenceWrong: mistaken === 0 ? 0 : r6(sumWrong / mistaken),
    confidentlyWrong,
  };
}
