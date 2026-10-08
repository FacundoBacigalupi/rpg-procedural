// Creencias `law` como hipótesis con evidencia (discovery §1-§3, Fase 2). Una ley del mundo no la
// consulta nadie: cada quien tiene una distribución de pesos sobre hipótesis candidatas y la mueve
// con observaciones, es decir, con lo que percibió de la causa y del efecto de un evento que la sim
// ya resolvió. Nada acá lee la verdad: la actualización usa la situación y el resultado percibidos.
//
// Primer caso del catálogo de `LawKey`: una regularidad de los campos (`field_yield`): de qué
// depende lo que rinde una hora de trabajo en la tierra. Las hipótesis candidatas son «no depende
// de nada», «depende de la estación» (qué mitad del año rinde), «depende de la luna» (qué mitad del
// ciclo) y «es cosa del Cielo» (no falsable: la evidencia no la mueve). La verdad (la estación manda)
// puede estar o no en el espacio de un agente; si nadie la pensó, solo baja la confianza en lo pensado.

import {
  type AgentId,
  compareStrings,
  type EntityRef,
  type EventId,
  log,
  pow,
  type Rng,
  type Tick,
} from "../../core/index.ts";
import { table } from "../world/index.ts";

/** Cuántos tramos distingue quien mira el año o el ciclo de la luna. */
export const BUCKETS = 4;

export type PhenomenonKey = "field_yield";
export type Correlate = "season" | "moon";
export const CORRELATES: readonly Correlate[] = ["season", "moon"];

/** La pregunta. La respuesta verdadera vive en la ley del mundo, no acá. */
export interface LawKey {
  readonly kind: "regularity";
  readonly phenomenon: PhenomenonKey;
}

export const FIELD_YIELD: LawKey = { kind: "regularity", phenomenon: "field_yield" };

export const lawKeyId = (k: LawKey): string => `${k.kind}:${k.phenomenon}`;

export type YieldOutcome = "poor" | "fair" | "good";
export const YIELD_OUTCOMES: readonly YieldOutcome[] = ["poor", "fair", "good"];

/** Lo que el observador notó de las condiciones (tramo del año que sintió, tramo de la luna). */
export interface PerceivedSituation {
  readonly season?: number;
  readonly moon?: number;
}

export type LawClaim =
  | { readonly kind: "none" }
  | { readonly kind: "moral" }
  | { readonly kind: "depends"; readonly on: Correlate; readonly high: readonly number[] };

export type HypothesisId = string;

export type HypothesisOrigin =
  | { readonly kind: "tradition"; readonly culture?: string }
  | { readonly kind: "generated"; readonly eventId: EventId; readonly rule: GenerationRule }
  | { readonly kind: "player"; readonly eventId: EventId };

/** Reglas de generación del catálogo de discovery §2 que ya existen. */
export type GenerationRule = "hidden_condition";

export interface Hypothesis {
  readonly id: HypothesisId;
  readonly key: LawKey;
  readonly claim: LawClaim;
  /** Las explicaciones morales o místicas no predicen nada: ni ganan ni pierden con la evidencia. */
  readonly falsifiable: boolean;
  readonly origin: HypothesisOrigin;
}

export interface Observation {
  /** Cuelga del evento real: una observación por agente y evento. */
  readonly id: string;
  readonly observer: AgentId;
  readonly key: LawKey;
  readonly eventId: EventId;
  readonly at: Tick;
  readonly situation: PerceivedSituation;
  readonly outcome: YieldOutcome;
  /** 0-1: qué tan nítido lo percibió. */
  readonly confidence: number;
  /** Cuánto tardó el efecto en manifestarse (segundos); el rinde del campo es inmediato. */
  readonly delay: number;
  /** Experimento a propósito o experiencia pasiva (los experimentos llegan en la Fase 3). */
  readonly deliberate: boolean;
}

export interface WeightedHypothesis {
  readonly h: Hypothesis;
  readonly weight: number;
}

export interface LawBelief {
  readonly key: LawKey;
  readonly hypotheses: readonly WeightedHypothesis[];
  /** El ledger que la sostiene, las últimas `MAX_EVIDENCE`; el resto pasa al conteo `seen`. */
  readonly evidence: readonly Observation[];
  /** Lo que no cuadra con la hipótesis dominante (ids de observación). */
  readonly anomalies: readonly string[];
  /** Cuántas observaciones recibió en total. */
  readonly seen: number;
  readonly updated: Tick;
}

export interface LawBeliefs {
  readonly beliefs: Readonly<Record<string, LawBelief>>;
  readonly originEventId: EventId;
}

export const LAW_BELIEFS = table<LawBeliefs>("mind.law");

/** Observaciones que se guardan completas por creencia (tier 4: ledger entero, acotado). */
export const MAX_EVIDENCE = 30;
export const MAX_ANOMALIES = 20;
/** Piso del peso de una hipótesis falsable: nunca queda del todo muerta. */
export const MIN_WEIGHT = 0.002;
/** Sesgo de confirmación (0-1): cuánto pesa lo que confirma al dominante y cuánto se descuenta lo que lo contradice. */
export const CONFIRMATION_BIAS = 0.25;
/** Peso con que entra una hipótesis del jugador. */
export const PLAYER_PRIOR = 0.1;
/** Peso con que entra una hipótesis que se le ocurre al agente. */
export const GENERATED_PRIOR = 0.08;
/** Anomalías acumuladas antes de que se le pueda ocurrir otra explicación. */
export const GENERATE_AFTER = 4;
/** Chance por observación anómala de que se le ocurra una (con el dominante flojo). */
export const GENERATE_CHANCE = 0.15;
/** Si el dominante pasa de este peso, no busca otra explicación. */
export const GENERATE_BELOW = 0.6;
/** Chance de que una hipótesis del catálogo figure en la tradición de un agente. */
export const TRADITION_COVERAGE = 0.55;
/** Peso de la hipótesis moral en la tradición. */
export const MORAL_PRIOR = 0.08;

const BASE: Readonly<Record<YieldOutcome, number>> = { poor: 0.3, fair: 0.4, good: 0.3 };
const HIGH: Readonly<Record<YieldOutcome, number>> = { poor: 0.1, fair: 0.25, good: 0.65 };
const LOW: Readonly<Record<YieldOutcome, number>> = { poor: 0.5, fair: 0.35, good: 0.15 };

const round = (x: number) => Math.round(x * 1e6) / 1e6;

/** El id de una hipótesis sale de su afirmación: las mismas ideas son la misma hipótesis. */
export function claimId(key: LawKey, claim: LawClaim): HypothesisId {
  const body =
    claim.kind === "depends"
      ? `depends:${claim.on}:${[...claim.high].sort().join("")}`
      : claim.kind;
  return `${lawKeyId(key)}/${body}`;
}

export function hypothesis(key: LawKey, claim: LawClaim, origin: HypothesisOrigin): Hypothesis {
  return { id: claimId(key, claim), key, claim, falsifiable: claim.kind !== "moral", origin };
}

/** Lo que espera ver quien cree `claim` en esa situación. */
export function predict(
  claim: LawClaim,
  situation: PerceivedSituation,
): Readonly<Record<YieldOutcome, number>> {
  if (claim.kind !== "depends") return BASE;
  const bucket = situation[claim.on];
  if (bucket === undefined) return BASE;
  return claim.high.includes(bucket) ? HIGH : LOW;
}

/** Las hipótesis que el catálogo permite formular para una ley (el espacio de lo pensable). */
export function candidateClaims(key: LawKey): LawClaim[] {
  if (key.phenomenon !== "field_yield") return [];
  const out: LawClaim[] = [{ kind: "none" }, { kind: "moral" }];
  for (const on of CORRELATES) {
    for (let k = 0; k < BUCKETS; k++) {
      out.push({ kind: "depends", on, high: [k, (k + 1) % BUCKETS].sort((a, b) => a - b) });
    }
  }
  return out;
}

const normalize = (hs: readonly WeightedHypothesis[]): WeightedHypothesis[] => {
  const total = hs.reduce((s, x) => s + x.weight, 0) || 1;
  return hs.map((x) => ({ h: x.h, weight: round(x.weight / total) }));
};

const byWeight = (a: WeightedHypothesis, b: WeightedHypothesis) =>
  b.weight - a.weight || compareStrings(a.h.id, b.h.id);

/** La hipótesis dominante (la de más peso; el empate lo desempata el id). */
export function dominant(b: LawBelief): WeightedHypothesis | undefined {
  return [...b.hypotheses].sort(byWeight)[0];
}

/**
 * La tradición: lo que la gente de la aldea «sabe» sobre esa ley. Siempre incluye «no depende de
 * nada» y la explicación moral; cada otra hipótesis figura con `TRADITION_COVERAGE`. Sale del rng
 * del agente: la verdad no interviene, así que puede faltar la correcta.
 */
export function priorBelief(key: LawKey, rng: Rng, at: Tick, culture?: string): LawBelief {
  const origin: HypothesisOrigin =
    culture === undefined ? { kind: "tradition" } : { kind: "tradition", culture };
  const claims = candidateClaims(key);
  const chosen = claims.filter(
    (c) =>
      c.kind === "none" ||
      c.kind === "moral" ||
      rng.fork("cover", claimId(key, c)).chance(TRADITION_COVERAGE),
  );
  const others = chosen.filter((c) => c.kind === "depends");
  const rest = 1 - MORAL_PRIOR;
  const share = others.length === 0 ? 0 : 0.7 / others.length;
  const hypotheses = chosen.map((c) => {
    const weight =
      c.kind === "moral"
        ? MORAL_PRIOR
        : c.kind === "none"
          ? rest * (others.length === 0 ? 1 : 0.3)
          : rest * share;
    return { h: hypothesis(key, c, origin), weight };
  });
  return {
    key,
    hypotheses: normalize(hypotheses),
    evidence: [],
    anomalies: [],
    seen: 0,
    updated: at,
  };
}

/** Peso por el que se multiplica `claim` ante una observación (la verosimilitud, ya temperada). */
function likelihood(
  claim: LawClaim,
  obs: Pick<Observation, "situation" | "outcome" | "confidence">,
  bias: number,
  isDominant: boolean,
): number {
  const p = predict(claim, obs.situation)[obs.outcome];
  let l = pow(p, Math.min(1, Math.max(0, obs.confidence)));
  if (isDominant) {
    // Sesgo de confirmación: lo que confirma al dominante pesa de más y lo que lo contradice se descuenta.
    l = p >= BASE[obs.outcome] ? pow(l, 1 + bias) : pow(l, 1 - bias);
  }
  return l;
}

/** Bayes sobre lo percibido. Las hipótesis no falsables no se mueven con la evidencia. */
export function updateWeights(
  hypotheses: readonly WeightedHypothesis[],
  obs: Pick<Observation, "situation" | "outcome" | "confidence">,
  bias: number = CONFIRMATION_BIAS,
): WeightedHypothesis[] {
  const top = [...hypotheses].sort(byWeight)[0];
  const next = hypotheses.map((x) => {
    if (!x.h.falsifiable) return x;
    const l = likelihood(x.h.claim, obs, bias, top !== undefined && x.h.id === top.h.id);
    return { h: x.h, weight: Math.max(MIN_WEIGHT, x.weight * l) };
  });
  // La hipótesis no falsable conserva su peso relativo: se reescala solo el resto.
  const fixed = next.filter((x) => !x.h.falsifiable);
  const fixedMass = fixed.reduce((s, x) => s + x.weight, 0);
  const moving = next.filter((x) => x.h.falsifiable);
  const movingMass = moving.reduce((s, x) => s + x.weight, 0) || 1;
  const budget = Math.max(0, 1 - fixedMass);
  return next.map((x) =>
    x.h.falsifiable ? { h: x.h, weight: round((x.weight / movingMass) * budget) } : x,
  );
}

/** Suma una observación al creer: pesos, ledger acotado y anomalías. Pura. */
export function observe(
  belief: LawBelief,
  obs: Observation,
  bias: number = CONFIRMATION_BIAS,
): LawBelief {
  if (belief.evidence.some((o) => o.id === obs.id)) return belief;
  const top = dominant(belief);
  const surprise = top ? predict(top.h.claim, obs.situation)[obs.outcome] : 1;
  const anomalous = top?.h.falsifiable === true && surprise < 0.2;
  return {
    ...belief,
    hypotheses: updateWeights(belief.hypotheses, obs, bias),
    evidence: [...belief.evidence, obs].slice(-MAX_EVIDENCE),
    anomalies: anomalous ? [...belief.anomalies, obs.id].slice(-MAX_ANOMALIES) : belief.anomalies,
    seen: belief.seen + 1,
    updated: obs.at,
  };
}

/**
 * Cuando algo no cuadra y el dominante está flojo, se le puede ocurrir otra explicación del
 * catálogo que todavía no pensaba («condición oculta»): la que mejor explicaría lo que ya anotó.
 * Usa solo su ledger, nunca la verdad. Devuelve la creencia con la hipótesis nueva, o la misma.
 */
export function wonder(belief: LawBelief, rng: Rng, eventId: EventId): LawBelief {
  const top = dominant(belief);
  if (!top || belief.anomalies.length < GENERATE_AFTER || top.weight >= GENERATE_BELOW)
    return belief;
  if (!rng.chance(GENERATE_CHANCE)) return belief;
  const known = new Set(belief.hypotheses.map((x) => x.h.id));
  const fresh = candidateClaims(belief.key).filter(
    (c) => c.kind !== "moral" && !known.has(claimId(belief.key, c)),
  );
  if (fresh.length === 0) return belief;
  const score = (c: LawClaim) =>
    belief.evidence.reduce((s, o) => s + log(predict(c, o.situation)[o.outcome]) * o.confidence, 0);
  const best = fresh
    .map((c) => ({ c, s: score(c) }))
    .sort(
      (a, b) => b.s - a.s || compareStrings(claimId(belief.key, a.c), claimId(belief.key, b.c)),
    )[0];
  if (!best) return belief;
  const h = hypothesis(belief.key, best.c, {
    kind: "generated",
    eventId,
    rule: "hidden_condition",
  });
  return { ...belief, hypotheses: addHypothesis(belief.hypotheses, h, GENERATED_PRIOR) };
}

function addHypothesis(
  hs: readonly WeightedHypothesis[],
  h: Hypothesis,
  weight: number,
): WeightedHypothesis[] {
  if (hs.some((x) => x.h.id === h.id)) return [...hs];
  const scaled = hs.map((x) => ({ h: x.h, weight: x.weight * (1 - weight) }));
  return normalize([...scaled, { h, weight }]);
}

/**
 * El jugador propone una hipótesis (discovery §14): entra al espacio del personaje con
 * `origin: player` y un peso chico; la confianza la mueve solo la evidencia. Si ya la pensaba, no cambia.
 */
export function proposeHypothesis(belief: LawBelief, claim: LawClaim, eventId: EventId): LawBelief {
  if (
    !candidateClaims(belief.key).some((c) => claimId(belief.key, c) === claimId(belief.key, claim))
  ) {
    throw new RangeError(`el catálogo no permite formular ${claimId(belief.key, claim)}`);
  }
  const h = hypothesis(belief.key, claim, { kind: "player", eventId });
  return { ...belief, hypotheses: addHypothesis(belief.hypotheses, h, PLAYER_PRIOR) };
}

/** El resultado percibido de una hora de campo: gramos contra una buena hora, con ruido de percepción. */
export function perceiveYield(gramsPerHour: number, goodHourGrams: number, rng: Rng): YieldOutcome {
  const ratio = (gramsPerHour / goodHourGrams) * (1 + 0.15 * rng.normal());
  return ratio < 0.25 ? "poor" : ratio >= 0.6 ? "good" : "fair";
}

/** Los tramos del año y de la luna que el observador sintió. `phase` 0-1; sin luna, sin tramo. */
export function bucketOf(phase: number): number {
  return Math.min(BUCKETS - 1, Math.floor((((phase % 1) + 1) % 1) * BUCKETS));
}

export function observationId(observer: EntityRef, eventId: EventId): string {
  return `${observer}@${eventId}`;
}
