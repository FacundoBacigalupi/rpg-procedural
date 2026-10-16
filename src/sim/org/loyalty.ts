// Consejo de aldea 5b (organizations §3 «lealtad»): la lealtad como relación con la ORGANIZACIÓN,
// no con quien la encabeza. Cada persona de la aldea guarda cuánto le debe al consejo (0-1): sube
// cuando una orden suya la favorece de verdad (`org.order_executed`) y baja cuando le falla
// (`org.order_failed`) o se desobedece (`org.order_refused`). Vive en la organización, así que
// sobrevive al cambio de cabeza: el respeto personal (RELATIONS) se va con el titular, esto no.
//
// Puro: sin IO. Solo lo escribe `life.council`; cada entrada recuerda el evento que la movió.

import type { AgentId, EventId, Tick } from "../../core/index.ts";
import { table } from "../world/index.ts";
import type { Organization } from "./council.ts";

export interface LoyaltyEntry {
  /** 0-1: sin trato con el consejo vale 0. */
  readonly value: number;
  readonly updated: Tick;
  /** El evento que la movió por última vez. */
  readonly cause: EventId;
  /** Cuántas veces se movió (para auditar). */
  readonly moves: number;
}

export interface OrgLoyalty {
  readonly toward: Readonly<Record<string, LoyaltyEntry>>;
}

/** La lealtad de la gente a cada consejo (clave: id de la organización). Solo la escribe `life.council`. */
export const ORG_LOYALTY = table<OrgLoyalty>("org.loyalty");
export const EMPTY_LOYALTY: OrgLoyalty = { toward: {} };

export interface LoyaltyRules {
  /** Cuánto sube la lealtad de quien recibe lo que el consejo ordenó. */
  readonly executedGain: number;
  /** Cuánto baja si la orden que lo favorecía falla (tesoro vacío, ejecutor caído). */
  readonly failedLoss: number;
  /** Cuánto baja si el ejecutor se negó a cumplirla (es peor: la organización no se hace obedecer). */
  readonly refusedLoss: number;
}

export const DEFAULT_LOYALTY_RULES: LoyaltyRules = {
  executedGain: 0.12,
  failedLoss: 0.05,
  refusedLoss: 0.1,
};

export type LoyaltyOutcome = "executed" | "failed" | "refused";

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const round6 = (x: number): number => Math.round(x * 1e6) / 1e6;

/** El cambio de lealtad que trae el resultado de una orden. */
export function outcomeDelta(outcome: LoyaltyOutcome, rules: LoyaltyRules): number {
  if (outcome === "executed") return rules.executedGain;
  return -(outcome === "failed" ? rules.failedLoss : rules.refusedLoss);
}

/** La lealtad de `who` al consejo (0 si nunca tuvo trato). */
export function loyaltyOf(l: OrgLoyalty | undefined, who: AgentId): number {
  return clamp01(l?.toward[who as string]?.value ?? 0);
}

/** Mueve la lealtad de `who` en `delta` (tope 0-1); sin trato previo y a la baja no crea entrada. */
export function shiftLoyalty(
  l: OrgLoyalty | undefined,
  who: AgentId,
  delta: number,
  at: Tick,
  cause: EventId,
): OrgLoyalty {
  const base = l ?? EMPTY_LOYALTY;
  const prev = base.toward[who as string];
  const value = round6(clamp01((prev?.value ?? 0) + delta));
  if (prev === undefined && value === 0) return base;
  return {
    toward: {
      ...base.toward,
      [who as string]: { value, updated: at, cause, moves: (prev?.moves ?? 0) + 1 },
    },
  };
}

/** Lo que tiene que cumplir toda tabla de lealtad; devuelve las violaciones. */
export function loyaltyViolations(org: Organization, l: OrgLoyalty): readonly string[] {
  const out: string[] = [];
  for (const [who, e] of Object.entries(l.toward)) {
    if (!(e.value >= 0 && e.value <= 1)) out.push(`${org.id}: lealtad de ${who} fuera de 0-1`);
    if (!e.cause) out.push(`${org.id}: lealtad de ${who} sin causa`);
    if (!(e.moves >= 1)) out.push(`${org.id}: lealtad de ${who} sin movimientos`);
  }
  return out;
}
