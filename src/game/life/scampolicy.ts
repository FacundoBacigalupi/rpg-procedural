// Política de la estafa de calidad en el juego (economy §6): quién infla y cuánto sale del
// temperamento (honestidad, audacia) y de la necesidad; cuánto le cree el comprador sale de lo que
// siente por el vendedor (`RELATIONS`). Son los proveedores de `ActOptions.scam`; opt-in, sin
// filas, RNG ni eventos propios.

import type { AgentId } from "../../core/index.ts";
import {
  type BondDef,
  clampTemper,
  type DimensionDef,
  INNATE,
  inflateFor,
  MIND,
  PERSON,
  RELATIONS,
  type ReadonlyWorldTruth,
  relationship,
  standardize,
  type Trait,
  trustFromRelation,
} from "../../sim/index.ts";

export interface ScamPolicyOptions {
  readonly dims: readonly DimensionDef[];
  readonly bonds: readonly BondDef[];
  readonly traits: readonly Trait[];
  /** Tick actual de la corrida (para el decaimiento de la relación). */
  readonly now: (truth: ReadonlyWorldTruth) => number;
  /** Necesidad 0-1 de quien vende (hambre, deuda). Sin dato, 0. */
  readonly need?: (truth: ReadonlyWorldTruth, who: AgentId) => number;
}

const unit = (x: number) => Math.min(1, Math.max(0, x));

/** `inflate` y `trust` listos para `ActOptions.scam`. */
export function scamProviders(o: ScamPolicyOptions) {
  return {
    inflate(truth: ReadonlyWorldTruth, seller: AgentId): number {
      const innate = truth.get(INNATE, seller);
      if (!innate) return 0;
      const z = standardize(innate, o.traits, truth.get(PERSON, seller)?.sex ?? "female");
      return inflateFor({
        honesty: unit(0.5 + 0.35 * clampTemper(z["willpower"] ?? 0)),
        boldness: unit(0.5 + 0.25 * clampTemper(z["boldness"] ?? 0)),
        need: o.need?.(truth, seller) ?? 0,
      });
    },
    trust(truth: ReadonlyWorldTruth, buyer: AgentId, seller: AgentId): number {
      const rel = relationship(truth.get(RELATIONS, buyer), seller, o.now(truth) as never, {
        dims: o.dims,
        bonds: o.bonds,
        schemaStrength: (s) => truth.get(MIND, buyer)?.schemas[s]?.strength ?? 0,
      });
      return trustFromRelation(rel.dims);
    },
  };
}
