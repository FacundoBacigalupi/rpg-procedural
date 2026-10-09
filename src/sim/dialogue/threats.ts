// Amenazas e intimidación (dialogue §9). Una amenaza vale lo que el amenazado cree: su credibilidad
// es capacidad creída × disposición creída a cumplir (no la verdad: un fanfarrón con fama es
// creíble, un asesino desconocido no). Una demostración reciente de poder sube la capacidad creída
// sin hacer falta alzar la voz. El amenazado elige entre ceder, desafiar, huir, pedir ayuda,
// denunciar o callar y vengarse después; en público la cara de ambos está en juego. Puro: devuelve
// la decisión y las consecuencias; escribir miedo, rencor y cara es de quien lo cablea.

import type { Random } from "../../core/index.ts";

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const round = (x: number) => Math.round(x * 1e6) / 1e6;

/** Lo que el amenazado cree de una cualidad del que amenaza. */
export interface BelievedTrait {
  /** 0-1: cuánto cree que tiene (capacidad de dañar, ganas de cumplir). */
  readonly level: number;
  /** 0-1: qué tan seguro está. Con poca confianza la creencia se arrastra hacia la duda (0.5). */
  readonly confidence: number;
}

/** El valor que pesa una creencia: sin confianza vale lo mismo que no saber (0.5). */
export function believedLevel(t: BelievedTrait | undefined): number {
  if (t === undefined) return 0.5;
  const c = clamp01(t.confidence);
  return clamp01(0.5 + (clamp01(t.level) - 0.5) * c);
}

/** Cuánto sube la capacidad creída una demostración fresca (fracción del trecho hasta 1). */
export const DEMONSTRATION_PULL = 0.8;

export interface CredibilityInput {
  readonly capability: BelievedTrait | undefined;
  readonly disposition: BelievedTrait | undefined;
  /** 0-1: lo que acaba de mostrar (una técnica, un cadáver, un arma). 0 si nada. */
  readonly shown?: number;
}

/** Credibilidad de la amenaza (0-1): capacidad creída × disposición creída. */
export function threatCredibility(i: CredibilityInput): number {
  const base = believedLevel(i.capability);
  const shown = clamp01(i.shown ?? 0);
  const cap = base + (1 - base) * DEMONSTRATION_PULL * shown;
  return round(clamp01(cap) * believedLevel(i.disposition));
}

export type ThreatResponse = "yield" | "defy" | "flee" | "call_help" | "denounce" | "stall";

export interface ThreatInput {
  /** Credibilidad ya calculada con `threatCredibility`. */
  readonly credibility: number;
  /** 0-1: lo que se amenaza hacer (muerte 1, una paliza 0.5, quedar mal 0.1). */
  readonly harm: number;
  /** 0-1: lo que cuesta darle lo que pide (bienes, orgullo, un principio). */
  readonly demandCost: number;
  /** 0-1: valentía del temperamento. */
  readonly courage: number;
  /** 0-1: orgullo / apego a la cara. */
  readonly pride: number;
  /** Los que presencian, sin contar a los dos. */
  readonly witnesses: number;
  /** 0-1: se cree capaz de vencer al otro (por lo que cree de su propia fuerza). */
  readonly selfConfidence: number;
  /** 0-1: puede escapar (distancia, velocidad, por dónde). */
  readonly escape: number;
  /** 0-1: hay quien lo ayude y lo oiga (aliados cerca, guardia, casa). */
  readonly help: number;
  /** 0-1: cree que la autoridad lo atendería y castigaría al otro. */
  readonly recourse: number;
}

/** Peso de los testigos en la cara que se juega, y su tope. */
export const WITNESS_FACE = 0.2;
export const WITNESS_FACE_CAP = 4;
/** Ruido de la decisión (el miedo no es una cuenta). */
export const THREAT_NOISE = 0.05;

export interface ThreatVerdict {
  readonly response: ThreatResponse;
  /** Puntaje de cada respuesta, para el inspector. */
  readonly scores: Readonly<Record<ThreatResponse, number>>;
  /** Cuánto miedo siente (0-1). */
  readonly fear: number;
}

/** Cara en juego (0-1) por cada paso en público, según el orgullo y los testigos. */
export function faceStakes(pride: number, witnesses: number): number {
  const w = Math.min(WITNESS_FACE_CAP, Math.max(0, Math.floor(witnesses)));
  return clamp01(clamp01(pride) * WITNESS_FACE * w);
}

/** El miedo (0-1): lo amenazado × la credibilidad, menos la valentía. */
export function threatFear(i: Pick<ThreatInput, "credibility" | "harm" | "courage">): number {
  return round(clamp01(i.credibility * i.harm * (1 - 0.6 * clamp01(i.courage))));
}

/**
 * Qué hace el amenazado. Ceder paga el miedo menos lo que cuesta darlo y la cara que se pierde en
 * público; desafiar paga la chance de que sea un farol (1 − credibilidad) o de ganar; huir y pedir
 * ayuda dependen de poder hacerlo; denunciar, de creer que la autoridad responde; con poco de todo
 * se queda quieto y se guarda el rencor (`stall`). Mismo seed, misma respuesta.
 */
export function weighThreat(i: ThreatInput, rng: Random): ThreatVerdict {
  const fear = threatFear(i);
  const stakes = faceStakes(i.pride, i.witnesses);
  const win = clamp01(i.selfConfidence);
  const scores: Record<ThreatResponse, number> = {
    yield: fear * 1.2 - i.demandCost * 0.6 - stakes * 0.5,
    defy: (1 - i.credibility) * 0.7 + win * 0.4 * i.courage + stakes * 0.5 - fear * 0.8,
    flee: fear * i.escape * 0.9 - stakes * 0.2,
    call_help: fear * i.help * 0.8 + (1 - i.credibility) * i.help * 0.1,
    denounce: fear * i.recourse * 0.7 - stakes * 0.1,
    stall: 0.25,
  };
  const order: ThreatResponse[] = ["yield", "defy", "flee", "call_help", "denounce", "stall"];
  let best: ThreatResponse = "stall";
  let top = Number.NEGATIVE_INFINITY;
  for (const r of order) {
    const v = scores[r] + (rng.float() - 0.5) * 2 * THREAT_NOISE;
    scores[r] = round(scores[r]);
    if (v > top) {
      top = v;
      best = r;
    }
  }
  return { response: best, scores, fear };
}

export interface ThreatAftermath {
  /** Miedo que queda en la relación (sube con el que se sintió). */
  readonly fearDelta: number;
  /** Rencor que queda (más si cedió o se lo tragó). */
  readonly resentmentDelta: number;
  /** Cambio de confianza hacia el que amenaza (siempre <= 0). */
  readonly trustDelta: number;
  /** Cara que pierde el amenazado (solo si cedió, huyó o se calló, y hubo testigos). */
  readonly targetFaceLoss: number;
  /** Se llevará el rencor a una venganza más tarde. */
  readonly vengeful: boolean;
}

/** Lo que deja la amenaza según lo que el amenazado hizo (§9: miedo y rencor en la relación). */
export function threatAftermath(
  verdict: ThreatVerdict,
  i: Pick<ThreatInput, "pride" | "witnesses" | "demandCost">,
  vindictiveness: number,
): ThreatAftermath {
  const swallowed = verdict.response === "yield" || verdict.response === "stall";
  const humiliated = swallowed || verdict.response === "flee";
  const stakes = faceStakes(i.pride, i.witnesses);
  const resent = clamp01(
    verdict.fear * 0.4 + (swallowed ? 0.3 + i.demandCost * 0.3 : 0.1) + stakes * 0.3,
  );
  return {
    fearDelta: round(verdict.fear * 0.5),
    resentmentDelta: round(resent),
    trustDelta: round(-(0.2 + verdict.fear * 0.4)),
    targetFaceLoss: humiliated ? round(stakes) : 0,
    vengeful: resent * clamp01(vindictiveness) >= 0.25,
  };
}

/** Cómo terminó una amenaza para quien la hizo: cumplió, no cumplió ante el desafío, o obedecieron. */
export type ThreatOutcome = "carried_out" | "backed_down" | "obeyed";

/**
 * Cara que gana o pierde el que amenazó (§9): si no cumple ante un desafío, la pierde (más con
 * testigos); si cedieron, gana poco; si cumple, gana respeto pero no cara. Devuelve un delta.
 */
export function threatFaceDelta(
  outcome: ThreatOutcome,
  witnesses: number,
  severity: number,
): number {
  const w = Math.min(WITNESS_FACE_CAP, Math.max(0, Math.floor(witnesses)));
  const scale = clamp01(severity) * (0.4 + 0.15 * w);
  if (outcome === "backed_down") return round(-clamp01(scale));
  if (outcome === "obeyed") return round(0.1 * scale);
  return 0;
}
