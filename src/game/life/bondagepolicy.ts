// Política del abuso en la servidumbre por deudas (credit §bondage): la chance diaria de que el
// acreedor rompa el trato sale de su temperamento (honestidad, audacia), de su necesidad y de lo
// que la cultura de la aldea le reprocha (`norms.theft`). Es el proveedor de
// `BondageTerms.abuse.chance`; opt-in, sin filas, RNG ni eventos propios.

import type { AgentId } from "../../core/index.ts";
import {
  clampTemper,
  dominantVariant,
  INNATE,
  PERSON,
  type ReadonlyWorldTruth,
  standardize,
  type Trait,
  villageCulture,
} from "../../sim/index.ts";

const unit = (x: number) => Math.min(1, Math.max(0, x));

/** Insumos de la chance de abuso (todo 0-1). */
export interface AbuseInputs {
  /** Honestidad del temperamento: 1 nunca abusa. */
  readonly honesty: number;
  /** Audacia: el audaz se anima más. */
  readonly boldness: number;
  /** Necesidad del acreedor (hambre, deuda). */
  readonly need: number;
  /** Cuánto lo frena la cultura (vergüenza pública): 0 nada, 1 todo. */
  readonly restraint: number;
}

/** Por debajo de esta propensión el acreedor no abusa. */
export const ABUSE_FLOOR = 0.15;
/** Tope de la chance diaria. */
export const ABUSE_MAX_CHANCE = 0.06;

/**
 * Chance diaria de que el acreedor rompa el trato. Puro y monótono: menos honestidad, más audacia
 * o más necesidad nunca bajan la chance; más freno cultural nunca la sube.
 */
export function abuseChanceOf(i: AbuseInputs): number {
  const drive = (1 - unit(i.honesty)) * (0.4 + 0.6 * unit(i.need)) * (1 - unit(i.restraint));
  if (drive < ABUSE_FLOOR) return 0;
  return unit(drive * (0.5 + unit(i.boldness))) * ABUSE_MAX_CHANCE;
}

/** Cuánto frena la cultura el abuso según cómo castiga el robo entre vecinos (`norms.theft`). */
export function cultureRestraintOf(truth: ReadonlyWorldTruth): number {
  const v = dominantVariant(villageCulture(truth), "norms.theft");
  return v === "from_anyone_shame" ? 0.6 : v === "from_neighbor_shame" ? 0.35 : 0;
}

/** `BondageTerms.abuse.chance` listo: temperamento innato del acreedor, su necesidad y la cultura de la aldea. */
export function bondageAbuseChance(
  traits: readonly Trait[],
  need?: (truth: ReadonlyWorldTruth, who: AgentId) => number,
) {
  return (truth: ReadonlyWorldTruth, creditor: AgentId): number => {
    const innate = truth.get(INNATE, creditor);
    if (!innate) return 0;
    const z = standardize(innate, traits, truth.get(PERSON, creditor)?.sex ?? "female");
    return abuseChanceOf({
      honesty: unit(0.5 + 0.35 * clampTemper(z["willpower"] ?? 0)),
      boldness: unit(0.5 + 0.25 * clampTemper(z["boldness"] ?? 0)),
      need: need?.(truth, creditor) ?? 0,
      restraint: cultureRestraintOf(truth),
    });
  };
}
