// El consejo de aldea como foro de la denuncia (law §3-§4, organizations §11, Consejo de aldea 5d).
// Puro y sin IO: no lee el mundo. Recibe lo que el consejo pesa sobre el acusado como números
// (`ForumStanding`: la autoridad que de hecho le reconoce y la lealtad que le guarda), que arma
// quien llama desde RELATIONS y ORG_LOYALTY (creencias y registros, nunca los hechos). Con eso
// decide qué hace el foro con una denuncia que ya pesó con `weighAccusation`: la deja pasar, media
// entre las partes, cita al acusado o lo sanciona. Sin autoridad, un consejo solo puede mediar.

import { ACCUSATION_ACTS_AT } from "./testimony.ts";

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** Lo que el consejo pesa sobre alguien: autoridad (0-1) y lealtad (0-1) de esa persona a él. */
export interface ForumStanding {
  readonly authority: number;
  readonly loyalty: number;
}

export const NO_STANDING: ForumStanding = { authority: 0, loyalty: 0 };

/** Autoridad mínima para citar a comparecer. */
export const SUMMON_AT = 0.25;
/** Autoridad mínima para imponer una sanción (sin ella solo se media). */
export const SANCTION_AT = 0.55;
/** Cuánto sube el umbral de creencia por la lealtad del acusado (el beneficio de la duda del propio). */
export const LOYALTY_DOUBT = 0.15;
/** Fracción del umbral desde la que, sin poder para más, el consejo al menos media. */
export const MEDIATE_FROM = 0.7;

export type ForumResponse = "ignore" | "mediate" | "summon" | "sanction";

/** Creencia que hace falta para que el consejo actúe contra alguien con esa lealtad. */
export function forumThreshold(standing: ForumStanding): number {
  return clamp01(ACCUSATION_ACTS_AT + LOYALTY_DOUBT * clamp01(standing.loyalty));
}

/**
 * Qué hace el foro con una denuncia ya pesada (`belief`, 0-1). Calumnia sospechada: la ignora.
 * Creída por encima del umbral: sanciona si tiene autoridad de sobra, cita si le alcanza para
 * eso, y si no media (no puede obligar). Creída a medias: media.
 */
export function forumResponse(
  belief: number,
  suspectsLiar: boolean,
  standing: ForumStanding,
): ForumResponse {
  if (suspectsLiar) return "ignore";
  const b = clamp01(belief);
  const threshold = forumThreshold(standing);
  const a = clamp01(standing.authority);
  if (b >= threshold) {
    if (a >= SANCTION_AT) return "sanction";
    if (a >= SUMMON_AT) return "summon";
    return "mediate";
  }
  return b >= threshold * MEDIATE_FROM ? "mediate" : "ignore";
}

/**
 * Cuánto de una pena (`scale`, p. ej. `penaltyScale` del hecho) puede imponer el foro: lo que
 * alcanza su autoridad sobre el acusado, sumada la lealtad que lo hace aceptar el fallo.
 */
export function forumPenalty(scale: number, standing: ForumStanding): number {
  const reach = 1 - (1 - clamp01(standing.authority)) * (1 - 0.5 * clamp01(standing.loyalty));
  return Math.max(0, scale) * reach;
}
