// Opinión ajena de la habilidad (skills §9): lo que alguien cree que sabe hacer otro, aparte de lo
// que sabe y de lo que el otro cree de sí. Es una estimación `{level, spread}` por (quién, habilidad)
// que sale de lo observado (vista, atención y lectura de quien mira; una pose la puede engañar) y de
// lo que se oye (rumor: pesa menos cuanto menos se confía en quien lo cuenta, y se exagera al
// pasar). La reputación viaja como creencia y se pincha con hechos vistos: una observación nítida
// que contradice la fama pesa más que la fama. Puro y sin azar: quien llama pasa el ruido ya tirado.

import type { AgentId, Tick } from "../../core/index.ts";
import { sqrt } from "../../core/index.ts";
import { table } from "../world/index.ts";

export type OpinionSource = "observed" | "rumor" | "certification" | "teacher_said";

export interface SkillOpinion {
  /** Qué nivel (0-1) cree que tiene y cuán seguro está (desvío de la estimación). */
  readonly estimate: { readonly level: number; readonly spread: number };
  /** Cuántas observaciones o testimonios la formaron. */
  readonly samples: number;
  readonly sources: readonly OpinionSource[];
  readonly updatedAt: Tick;
}

/** Lo que un agente cree de los demás, por clave `opinionKey(about, skill)`. */
export type Opinions = Readonly<Record<string, SkillOpinion>>;

/** La tabla de opinión ajena en la verdad, por `AgentId` (el que opina). */
export const OPINIONS = table<Opinions>("skills.opinion");

/** Dispersión de una opinión sin base alguna. */
export const OPINION_PRIOR_SPREAD = 0.35;
/** Piso de la dispersión: nadie conoce a otro del todo. */
export const OPINION_SPREAD_FLOOR = 0.05;
/** Desvío de una observación perfecta y de una pésima (calibración abierta). */
export const OBSERVE_SPREAD_BEST = 0.06;
export const OBSERVE_SPREAD_WORST = 0.4;
/** Desvío base de un rumor antes de ponderar por confianza, y cuánto se exagera al contarlo. */
export const RUMOR_SPREAD = 0.25;
export const RUMOR_EXAGGERATION = 0.08;
/** Cuánta dispersión se pierde por cada paso que el rumor ya dio de boca en boca. */
export const RUMOR_HOP_SPREAD = 0.05;
/** Una sorpresa mayor que esto (en desvíos) hace que la creencia previa se cuestione. */
export const SURPRISE_SDS = 2;
/** Cuánto se ensancha la duda previa ante una sorpresa. */
export const SURPRISE_DOUBT = 0.5;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const round = (x: number) => Math.round(x * 1e6) / 1e6;

export function opinionKey(about: AgentId | string, skill: string): string {
  return `${about}|${skill}`;
}

/** Fusiona una evidencia (nivel con desvío) en la opinión previa por precisión (Bayes normal). */
function fuse(
  prev: SkillOpinion | undefined,
  level: number,
  spread: number,
  source: OpinionSource,
  tick: Tick,
): SkillOpinion {
  const priorLevel = prev?.estimate.level ?? level;
  let priorSpread = prev?.estimate.spread ?? OPINION_PRIOR_SPREAD;
  // Pincharse: si la evidencia contradice con fuerza lo que creía, duda de lo anterior.
  const surprise = Math.abs(level - priorLevel) / sqrt(priorSpread * priorSpread + spread * spread);
  if (prev && surprise > SURPRISE_SDS) {
    priorSpread = Math.min(
      OPINION_PRIOR_SPREAD,
      priorSpread * (1 + SURPRISE_DOUBT * (surprise - SURPRISE_SDS)),
    );
  }
  const wPrior = 1 / (priorSpread * priorSpread);
  const wNew = 1 / (spread * spread);
  const mean = (priorLevel * wPrior + level * wNew) / (wPrior + wNew);
  const sd = Math.max(OPINION_SPREAD_FLOOR, sqrt(1 / (wPrior + wNew)));
  return {
    estimate: { level: round(clamp01(mean)), spread: round(sd) },
    samples: (prev?.samples ?? 0) + 1,
    sources: prev?.sources.includes(source) ? prev.sources : [...(prev?.sources ?? []), source],
    updatedAt: tick,
  };
}

/** La nitidez de lo visto (0-1) a partir de qué tanto percibió y cuánto sabe leer. */
export function observationClarity(seen: number, observerReading: number): number {
  return clamp01(seen * (0.4 + 0.6 * clamp01(observerReading)));
}

/**
 * Lo que ver actuar a otro le dice a quien mira: la opinión nueva. `shown` es el nivel que el
 * otro mostró (con la pose ya aplicada: si lo engañó, lo mostrado difiere de lo verdadero) y
 * `noise` una normal tirada por quien llama.
 */
export function observeSkill(
  prev: SkillOpinion | undefined,
  shown: number,
  seen: number,
  observerReading: number,
  noise: number,
  tick: Tick,
): SkillOpinion {
  const clarity = observationClarity(seen, observerReading);
  const spread = OBSERVE_SPREAD_WORST + (OBSERVE_SPREAD_BEST - OBSERVE_SPREAD_WORST) * clarity;
  return fuse(prev, clamp01(shown + spread * noise), spread, "observed", tick);
}

/** Un rumor sobre la habilidad de alguien: lo que se cuenta, tal cual lo cuenta quien lo cuenta. */
export interface SkillRumor {
  readonly level: number;
  /** Cuántas bocas pasó (0 es testigo directo contando lo que vio). */
  readonly hops: number;
  /** Cuánto confía el que oye en quien le cuenta, 0-1. */
  readonly trust: number;
  /** Si el que cuenta quiere engrandecer (+) o desmerecer (−) al otro, -1 a 1. */
  readonly slant?: number;
  readonly source?: Extract<OpinionSource, "rumor" | "certification" | "teacher_said">;
}

/**
 * Oír de la habilidad de otro. La confianza baja el peso, cada boca lo ensancha y quien cuenta lo
 * infla o lo desmerece (`slant`). Una certificación o un maestro valen más que un rumor de plaza.
 */
export function hearSkill(prev: SkillOpinion | undefined, r: SkillRumor, tick: Tick): SkillOpinion {
  const source = r.source ?? "rumor";
  const base = source === "rumor" ? RUMOR_SPREAD : RUMOR_SPREAD * 0.5;
  const trust = clamp01(r.trust);
  const spread = (base + RUMOR_HOP_SPREAD * r.hops) / (0.2 + 0.8 * trust);
  const told = clamp01(r.level + RUMOR_EXAGGERATION * (r.slant ?? 0) * (1 + r.hops));
  return fuse(prev, told, spread, source, tick);
}

/** Lo que cuenta de la habilidad de otro quien opina: su estimación, con la duda que le queda. */
export function tellSkill(op: SkillOpinion, hops: number, trust: number): SkillRumor {
  return { level: op.estimate.level, hops: hops + 1, trust };
}

/** La reputación de alguien en una habilidad: el promedio de lo que cree la gente, por precisión. */
export function reputationOf(
  opinions: readonly SkillOpinion[],
): { level: number; spread: number } | null {
  if (opinions.length === 0) return null;
  let w = 0;
  let s = 0;
  for (const o of opinions) {
    const p = 1 / (o.estimate.spread * o.estimate.spread);
    w += p;
    s += p * o.estimate.level;
  }
  return { level: round(s / w), spread: round(Math.max(OPINION_SPREAD_FLOOR, sqrt(1 / w))) };
}

/**
 * Cuánto se sobrestima o subestima a alguien (con signo): lo que cree menos lo verdadero. Es la
 * brecha que una pelea o un oficio vistos cierran; el inspector la muestra.
 */
export function opinionError(op: SkillOpinion, trueLevel: number): number {
  return round(op.estimate.level - trueLevel);
}
