// Política de la estafa de calidad en el juego (economy §6): quién infla y cuánto sale del
// temperamento (honestidad, audacia) y de la necesidad; cuánto le cree el comprador sale de lo que
// siente por el vendedor (`RELATIONS`). Son los proveedores de `ActOptions.scam`; opt-in, sin
// filas, RNG ni eventos propios.

import type { AgentId, Tick } from "../../core/index.ts";
import {
  BODY_STATE,
  type BodyPlanDef,
  type BondDef,
  CREDIT_LIMIT_GRAMS,
  clampTemper,
  type DimensionDef,
  INNATE,
  inflateFor,
  liveBetween,
  MIND,
  needsFrom,
  PERSON,
  RELATIONS,
  type ReadonlyWorldTruth,
  relationship,
  standardize,
  type Trait,
  trustFromRelation,
} from "../../sim/index.ts";
import { creditRows } from "./credit.ts";

export interface ScamPolicyOptions {
  readonly dims: readonly DimensionDef[];
  readonly bonds: readonly BondDef[];
  readonly traits: readonly Trait[];
  /** Necesidad 0-1 de quien vende (hambre, deuda; ver `scamNeedOf`). Sin dato, 0. */
  readonly need?: (truth: ReadonlyWorldTruth, who: AgentId) => number;
}

/** Lo que adeuda vivo (en gramos) con el que la necesidad por deuda llega a 1: dos veces el tope del fiado. */
export const SCAM_DEBT_FULL = 2 * CREDIT_LIMIT_GRAMS;

/**
 * La necesidad de quien vende: la mayor entre su hambre (`needsFrom` del cuerpo) y el peso de lo
 * que debe (deudas vivas del `CREDIT`, contra `SCAM_DEBT_FULL`). Sin cuerpo ni deudas, 0.
 */
export function scamNeedOf(bodyPlans: readonly BodyPlanDef[]) {
  const plans = new Map(bodyPlans.map((p) => [p.id, p]));
  return (truth: ReadonlyWorldTruth, who: AgentId): number => {
    const body = truth.get(BODY_STATE, who);
    const plan = body ? plans.get(body.plan) : undefined;
    const hunger = body && plan ? (needsFrom(plan, body).hunger ?? 0) : 0;
    const owed = liveBetween(creditRows(truth), who).reduce((t, r) => t + r.credit.owed, 0);
    return Math.max(hunger, unit(owed / SCAM_DEBT_FULL));
  };
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
    trust(truth: ReadonlyWorldTruth, buyer: AgentId, seller: AgentId, now: Tick): number {
      const rel = relationship(truth.get(RELATIONS, buyer), seller, now as never, {
        dims: o.dims,
        bonds: o.bonds,
        schemaStrength: (s) => truth.get(MIND, buyer)?.schemas[s]?.strength ?? 0,
      });
      return trustFromRelation(rel.dims);
    },
  };
}

/**
 * Chance de que el vendedor devuelva el sobreprecio al que se lo reclama: su honestidad (carácter)
 * menos el peso de su necesidad (hambre o deuda). Es el proveedor de `ScamDiscoveryOptions.refund`.
 */
export function scamRefundOf(
  traits: readonly Trait[],
  need: (truth: ReadonlyWorldTruth, who: AgentId) => number,
) {
  return (truth: ReadonlyWorldTruth, seller: AgentId): number => {
    const innate = truth.get(INNATE, seller);
    const z = innate
      ? standardize(innate, traits, truth.get(PERSON, seller)?.sex ?? "female")
      : undefined;
    const honesty = unit(0.5 + 0.35 * clampTemper(z?.["willpower"] ?? 0));
    return unit(honesty * (1 - 0.7 * unit(need(truth, seller))));
  };
}

/** Qué tan fino mira un comprador (0-1): sentidos sin oficio, con el sesgo de su percepción innata (como `handsOf`). */
export function scamEyeOf(traits: readonly Trait[]) {
  return (truth: ReadonlyWorldTruth, who: AgentId): number => {
    const innate = truth.get(INNATE, who);
    if (!innate) return 0.5;
    const z = standardize(innate, traits, truth.get(PERSON, who)?.sex ?? "female");
    return unit(0.25 + 0.08 * (z["perception"] ?? 0));
  };
}
