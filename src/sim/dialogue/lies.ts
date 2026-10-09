// Mentir y detectar la mentira (dialogue §2 `lie`, §4; perception §6). Mentir es decir algo que
// uno cree falso para instalar esa creencia en el otro: la sinceridad se mide contra lo que el
// hablante cree (no contra la verdad: quien repite un error ajeno no miente, quien dice sin
// querer la verdad que cree falsa sí). El oyente no ve la mentira: ve señales (nervios, qué tan
// raro suena, qué tan bien conoce al hablante) y decide si cree, duda o acusa. Detectar es
// probable pero no seguro, y desconfiar de un sincero también pasa (falsa alarma). Todo puro.

import type { AgentId, Random, Tick } from "../../core/index.ts";
import {
  type Belief,
  type BeliefValue,
  beliefConfidenceAt,
  sameValue,
} from "../knowledge/index.ts";

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const round = (x: number) => Math.round(x * 1e6) / 1e6;

/** Confianza mínima en lo que uno cree para que decir lo contrario cuente como mentir. */
export const LIE_MIN_BELIEF = 0.5;

/** Lo que un hablante afirma sobre una proposición, y lo que él mismo cree de ella. */
export interface Assertion {
  readonly value: BeliefValue;
  /** Su creencia propia sobre lo mismo, o `undefined` si no sabe nada. */
  readonly own: Belief | undefined;
}

/** Lo que es el decir: sincero, mentira, o a ciegas (no sabe: ni miente ni informa). */
export type Sincerity = "sincere" | "lie" | "blind";

/** ¿Miente quien afirma `a.value`? Solo si cree lo contrario con convicción. */
export function sincerityOf(a: Assertion, now: Tick): Sincerity {
  if (a.own === undefined) return "blind";
  if (sameValue(a.own.value, a.value)) return "sincere";
  return beliefConfidenceAt(a.own, now) >= LIE_MIN_BELIEF ? "lie" : "blind";
}

// --- Querer mentir ---------------------------------------------------------------------------

export interface SpeakerLieMotive {
  /** 0-1: honestidad del temperamento (alta: miente poco). */
  readonly honesty: number;
  /** 0-1: cuánto gana si el otro lo cree. */
  readonly gain: number;
  /** 0-1: cuánto pierde si lo descubren (relación, cara, castigo). */
  readonly exposure: number;
  /** 0-1: qué tan buen mentiroso se cree (autoimagen de la habilidad). */
  readonly selfBelief: number;
  /** El que pregunta ya demostró que verifica, o hay testigos que saben la verdad. */
  readonly checkable?: boolean;
}

/** Peso de la honestidad en lo que cuesta mentir. */
export const HONESTY_COST = 0.6;

/** La inclinación a mentir (0-1): ganancia contra el costo moral y el riesgo creído. */
export function lieInclination(m: SpeakerLieMotive): number {
  const risk = m.exposure * (1 - m.selfBelief * 0.7) * (m.checkable ? 1.5 : 1);
  return round(clamp01(0.5 + m.gain - risk - HONESTY_COST * m.honesty));
}

/** ¿Decide mentir? Solo si la inclinación pasa de 0.5, y entonces con esa chance de más. */
export function decidesToLie(m: SpeakerLieMotive, rng: Random): boolean {
  const p = lieInclination(m);
  return p > 0.5 && rng.chance((p - 0.5) * 2);
}

// --- Detectar --------------------------------------------------------------------------------

export interface DetectionInput {
  /** La afirmación es de verdad una mentira (el oyente no lo sabe; define cuántas señales hay). */
  readonly lying: boolean;
  /** 0-1: control del mentiroso (práctica, sangre fría). */
  readonly control: number;
  /** 0-1: nerviosismo/emoción del hablante que se filtra (miedo, culpa, alcohol, cansancio). */
  readonly nerves: number;
  /** 0-1: percepción del oyente para leer personas (perception §6, teoría de la mente). */
  readonly insight: number;
  /** 0-1: cuánto conoce al hablante (sabe cómo suena cuando miente). */
  readonly familiarity: number;
  /** 0-1: cuánto choca lo dicho con lo que el oyente ya cree. */
  readonly conflict: number;
  /** 0-1: qué tan inverosímil le suena en sí. */
  readonly implausibility: number;
  /** 0-1: confianza previa del oyente en el hablante: baja la guardia. */
  readonly trust: number;
  /** 0-1: el oyente trae sospecha (ya lo engañaron, es desconfiado de temperamento). */
  readonly wariness: number;
}

export const DETECT_BASE = 0.05;
export const DETECT_SKILL = 0.45;
export const DETECT_CONTEXT = 0.35;
export const FALSE_ALARM = 0.08;
/** Cuánto de los nervios de un sincero se toma por señal (el nervioso honesto es ruido). */
export const HONEST_LEAK = 0.35;

/**
 * Qué tanto sospecha el oyente (0-1). Un mentiroso filtra nervios menos control; un sincero
 * también, pero menos. Lo que choca con lo que el oyente sabe y lo inverosímil sospechan aunque
 * no haya señales; la confianza amortigua y el desconfiado sospecha más; conocer al hablante
 * afina la lectura.
 */
export function suspicion(d: DetectionInput): number {
  const leak = d.lying
    ? clamp01(d.nerves * (1 - 0.8 * d.control) + 0.15 * (1 - d.control))
    : d.nerves * HONEST_LEAK;
  const reading = leak * d.insight * (0.5 + 0.5 * d.familiarity);
  const context = Math.max(d.conflict, d.implausibility * 0.8);
  const guard = (1 - 0.6 * d.trust) * (0.7 + 0.6 * d.wariness);
  const raw = DETECT_BASE + DETECT_SKILL * reading + DETECT_CONTEXT * context * (0.4 + d.insight);
  return round(clamp01(raw * guard + (d.lying ? 0 : FALSE_ALARM * d.wariness)));
}

export type LieVerdict =
  /** Lo acepta como dicho. */
  | "believed"
  /** No se lo cree del todo: la creencia entra con poca confianza. */
  | "doubted"
  /** Cree que mintió: no lo acepta, baja la confianza en el hablante y queda en la memoria. */
  | "caught";

export interface LieJudgement {
  readonly verdict: LieVerdict;
  /** La sospecha base (sin el ruido de la tirada). */
  readonly suspicion: number;
  /** Multiplicador de la credibilidad al revisar la creencia (1 creído, 0 descartado). */
  readonly credit: number;
  /** Cambio en la confianza del oyente en el hablante (negativo si lo cree mentiroso). */
  readonly trustDelta: number;
  /** El veredicto acierta con la verdad (mentira sospechada, o sincero creído). */
  readonly correct: boolean;
}

export const DOUBT_AT = 0.3;
export const CATCH_AT = 0.55;
export const TRUST_LOSS_CAUGHT = -0.3;
export const TRUST_LOSS_DOUBT = -0.05;
/** Cuánto de la credibilidad queda cuando duda. */
export const DOUBT_CREDIT = 0.4;
/** Desvío del ruido de juicio. */
export const JUDGE_NOISE = 0.08;

/** El juicio del oyente: la sospecha con un ruido propio (no es un umbral duro). */
export function judgeStatement(d: DetectionInput, rng: Random): LieJudgement {
  const s = suspicion(d);
  const felt = clamp01(s + rng.normal(0, JUDGE_NOISE));
  const verdict: LieVerdict =
    felt >= CATCH_AT ? "caught" : felt >= DOUBT_AT ? "doubted" : "believed";
  const credit = verdict === "believed" ? 1 : verdict === "doubted" ? DOUBT_CREDIT : 0;
  const trustDelta =
    verdict === "caught" ? TRUST_LOSS_CAUGHT : verdict === "doubted" ? TRUST_LOSS_DOUBT : 0;
  return {
    verdict,
    suspicion: s,
    credit,
    trustDelta,
    correct: d.lying ? verdict !== "believed" : verdict === "believed",
  };
}

/** La confianza (0-1) con la que entra lo contado a `revise`: crédito del hablante × verosimilitud × juicio. */
export function toldConfidence(
  speakerTrust: number,
  plausibility: number,
  judgement: LieJudgement,
): number {
  return round(clamp01((0.2 + 0.6 * speakerTrust) * (0.4 + 0.6 * plausibility) * judgement.credit));
}

/** Una mentira sorprendida: lo que el oyente guarda (para su memoria y su opinión del hablante). */
export interface CaughtLie {
  readonly liar: AgentId;
  readonly by: AgentId;
  readonly at: Tick;
  /** Era de verdad una mentira; si no, fue una injusticia con un sincero. */
  readonly certain: boolean;
}

/** Lo que queda en el oyente si cree haber sorprendido una mentira; `null` si no la sospechó. */
export function recordCaught(
  liar: AgentId,
  by: AgentId,
  at: Tick,
  j: LieJudgement,
): CaughtLie | null {
  return j.verdict === "caught" ? { liar, by, at, certain: j.correct } : null;
}
