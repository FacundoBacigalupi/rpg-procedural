// El diario de hipótesis del personaje (discovery §14): sus creencias `law` como hipótesis con peso,
// la evidencia que las sostiene y las anomalías. Muro con la verdad: salen solo de `LAW_BELIEFS`
// (lo que cree), nunca de la ley del mundo; el peso va en palabras y no en números.

import {
  dominant,
  type Hypothesis,
  LAW_BELIEFS,
  type LawBelief,
  type LawClaim,
  type YieldOutcome,
} from "../../sim/index.ts";
import type { LifeWorld } from "./world.ts";

export type Confidence = "doubtful" | "possible" | "likely" | "near_certain";
export type HypothesisSource = "tradition" | "own" | "yours";

export interface HypothesisEntry {
  readonly claim: LawClaim;
  readonly confidence: Confidence;
  /** Si la evidencia puede moverla (las explicaciones morales no). */
  readonly falsifiable: boolean;
  readonly source: HypothesisSource;
}

export interface LawEntry {
  readonly phenomenon: string;
  readonly hypotheses: readonly HypothesisEntry[];
  /** Cuántas veces lo vio, y las últimas (lo que notó de las condiciones y del resultado). */
  readonly seen: number;
  readonly recent: readonly {
    readonly season?: number;
    readonly moon?: number;
    readonly outcome: YieldOutcome;
  }[];
  /** Cuántas veces lo que vio no cuadró con lo que más cree. */
  readonly anomalies: number;
}

export interface HypothesesPanel {
  readonly laws: readonly LawEntry[];
}

/** Las últimas observaciones que muestra el diario por ley. */
export const DIARY_RECENT = 6;

export function confidenceOf(weight: number): Confidence {
  if (weight >= 0.8) return "near_certain";
  if (weight >= 0.4) return "likely";
  if (weight >= 0.12) return "possible";
  return "doubtful";
}

const sourceOf = (h: Hypothesis): HypothesisSource =>
  h.origin.kind === "player" ? "yours" : h.origin.kind === "generated" ? "own" : "tradition";

function lawEntry(b: LawBelief): LawEntry {
  const ranked = [...b.hypotheses].sort(
    (x, y) => y.weight - x.weight || (x.h.id < y.h.id ? -1 : 1),
  );
  return {
    phenomenon: b.key.phenomenon,
    hypotheses: ranked.map((x) => ({
      claim: x.h.claim,
      confidence: confidenceOf(x.weight),
      falsifiable: x.h.falsifiable,
      source: sourceOf(x.h),
    })),
    seen: b.seen,
    recent: b.evidence.slice(-DIARY_RECENT).map((o) => ({
      ...(o.situation.season === undefined ? {} : { season: o.situation.season }),
      ...(o.situation.moon === undefined ? {} : { moon: o.situation.moon }),
      outcome: o.outcome,
    })),
    anomalies: dominant(b) ? b.anomalies.length : 0,
  };
}

export function hypothesesPanel(w: LifeWorld): HypothesesPanel {
  const beliefs = w.truth.get(LAW_BELIEFS, w.player)?.beliefs ?? {};
  return {
    laws: Object.keys(beliefs)
      .sort()
      .map((k) => lawEntry(beliefs[k] as LawBelief)),
  };
}
