// Halagos, insultos y registro equivocado (dialogue §10). El halago funciona con la vanidad del otro
// y si no suena hueco; adular de más a alguien perspicaz baja la confianza. El insulto y el
// tratamiento equivocado son ofensas (social-structure §4) cuyo tamaño sale de lo que el ofendido
// cree de los rangos y de los testigos; se miden con el mismo `Offense` y la misma `faceLoss`.

import type { RegisterSlip } from "../language/index.ts";
import type { Offense } from "../social/index.ts";

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const round = (x: number) => Math.round(x * 1e6) / 1e6;

export type FlatteryKind = "pleased" | "flat" | "hollow";

export interface FlatteryInput {
  /** 0-1: vanidad del halagado. */
  readonly vanity: number;
  /** 0-1: cuánto elogia (la hipérbole) por encima de lo que el otro cree merecer. */
  readonly excess: number;
  /** 0-1: perspicacia del halagado (percepción social + desconfianza). */
  readonly insight: number;
  /** 0-1: confianza en quien halaga. */
  readonly trust: number;
  /** El halagado sabe que el otro quiere algo de él. */
  readonly motiveKnown: boolean;
  /** Halagos recientes del mismo (los repetidos se desgastan). */
  readonly recent: number;
}

export interface FlatteryResult {
  readonly kind: FlatteryKind;
  /** Cambio de afecto hacia quien halaga. */
  readonly warmthDelta: number;
  /** Cambio de confianza (negativo si se percibe hueco). */
  readonly trustDelta: number;
  /** 0-1: lo hueco que sonó. */
  readonly hollowness: number;
}

/** Desgaste (0-1) del halago con 4 o más recientes. */
export const FLATTERY_WEAR = 1;

/** El efecto de un halago (§10): vanidad contra hueco; el perspicaz pesca la hipérbole. */
export function judgeFlattery(i: FlatteryInput): FlatteryResult {
  const wear = clamp01(Math.max(0, i.recent) / 4) * FLATTERY_WEAR;
  const hollow = clamp01(
    clamp01(i.excess) * (0.4 + 0.6 * clamp01(i.insight)) * (1 - 0.4 * clamp01(i.trust)) +
      (i.motiveKnown ? 0.35 : 0) +
      wear * 0.3,
  );
  if (hollow >= 0.5) {
    return {
      kind: "hollow",
      warmthDelta: round(-0.05 * hollow),
      trustDelta: round(-0.25 * hollow * (0.5 + clamp01(i.insight))),
      hollowness: round(hollow),
    };
  }
  const pleasure = clamp01(clamp01(i.vanity) * (1 - hollow) * (1 - wear * 0.7));
  if (pleasure < 0.1) {
    return { kind: "flat", warmthDelta: 0, trustDelta: 0, hollowness: round(hollow) };
  }
  return {
    kind: "pleased",
    warmthDelta: round(0.15 * pleasure),
    trustDelta: round(0.03 * pleasure),
    hollowness: round(hollow),
  };
}

export interface InsultInput {
  /** 0-1: lo filoso del insulto (qué toca: linaje, cuerpo, el maestro). */
  readonly sting: number;
  /** 0-1: cuánto suena a verdad al insultado (duele más lo cierto). */
  readonly truth: number;
  /** Rango que el insultado cree propio menos el del insultador (positivo: el insultador es inferior). */
  readonly gap: number;
  readonly witnesses: number;
}

export const INSULT_TRUTH_WEIGHT = 0.3;
export const INSULT_GAP_GROWTH = 0.25;
export const INSULT_WITNESS_GROWTH = 0.25;
export const INSULT_WITNESS_CAP = 4;

/** Un insulto como ofensa (§10): da cara perdida (`faceLoss`) y un motivo al insultado. */
export function insultOffense(i: InsultInput): Offense {
  const witnesses = Math.max(0, Math.floor(i.witnesses));
  const gap = Math.max(0, Math.floor(i.gap));
  const size =
    clamp01(i.sting) *
    (1 + INSULT_TRUTH_WEIGHT * clamp01(i.truth)) *
    (1 + INSULT_GAP_GROWTH * gap) *
    (1 + INSULT_WITNESS_GROWTH * Math.min(witnesses, INSULT_WITNESS_CAP));
  return { norm: "insult", size: round(clamp01(size)), gap, witnesses };
}

export interface RegisterOffenseInput {
  readonly slip: RegisterSlip;
  /** Escalones de rango que el ofendido cree que hay entre ambos (positivo: el otro es inferior). */
  readonly gap: number;
  readonly witnesses: number;
}

export const REGISTER_GAP_GROWTH = 0.3;
/** Fracción con que pesa pasarse de ceremonioso frente a quedarse corto. */
export const OVERFORMAL_WEIGHT = 0.4;

/**
 * El registro equivocado como ofensa (§10): el tamaño del desliz crece con la distancia de rango
 * creída y los testigos. Pasarse de ceremonioso apenas ofende.
 */
export function registerOffense(i: RegisterOffenseInput): Offense {
  const witnesses = Math.max(0, Math.floor(i.witnesses));
  const gap = Math.max(0, Math.floor(i.gap));
  const base = i.slip.direction === "too-casual" ? i.slip.size : i.slip.size * OVERFORMAL_WEIGHT;
  const size =
    base *
    (1 + REGISTER_GAP_GROWTH * gap) *
    (1 + INSULT_WITNESS_GROWTH * Math.min(witnesses, INSULT_WITNESS_CAP));
  return { norm: "register", size: round(clamp01(size)), gap, witnesses };
}
