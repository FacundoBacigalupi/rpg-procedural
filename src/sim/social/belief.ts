// La posición ajena como creencia (social-structure §3, perception §6, Fase 2). Nadie lee el
// `STATUS` de otro: lo deduce de lo que ve (la ropa), de lo que sabe (lo conoce de siempre) o de
// lo que le contaron, y puede errar. `STANDING_BELIEFS` guarda, por observador, qué rango cree
// que tiene cada persona que alguna vez leyó, con cuánta confianza y por qué vía. La verdad
// (`STATUS`) nunca se consulta para decidir cómo tratar a alguien: se consulta esta creencia.
//
// Los errores salen de las mismas marcas: quien se viste de lo que no es se lee como lo que
// aparenta (el impostor engaña sin tirada alguna), la luz y la distancia confunden a un escalón
// vecino, y la riqueza exhibida se sobrestima más de lo que la humildad se subestima.

import type { AgentId, EventId, Random, Tick } from "../../core/index.ts";
import { table } from "../world/index.ts";
import { type Attire, type StatusDef, standingOf } from "./status.ts";

export const STANDING_BASES = ["known", "attire", "told"] as const;
/** De dónde viene lo que alguien cree del rango de otro. */
export type StandingBasis = (typeof STANDING_BASES)[number];

export interface StandingBelief {
  readonly about: AgentId;
  /** El rango ritual creído (fraccionario si dudaba entre dos escalones). */
  readonly rank: number;
  /** 0-1: cuánto se fía de su lectura. */
  readonly confidence: number;
  readonly basis: StandingBasis;
  readonly seenAt: Tick;
  readonly originEventId: EventId;
}

export interface StandingBeliefs {
  readonly beliefs: readonly StandingBelief[];
}

/** Lo que cada uno cree del rango de los demás, en su entidad. */
export const STANDING_BELIEFS = table<StandingBeliefs>("social.standing_beliefs");

/** Confianza de lo que se deduce de la ropa, contra 1 de lo que se conoce de siempre. */
export const ATTIRE_CONFIDENCE = 0.55;
/** Confianza de lo que cuentan (el que cuenta también lo dedujo). */
export const TOLD_CONFIDENCE = 0.4;
/** Cuánto pesa de más lo que luce rico sobre lo que luce pobre al leer el escalón (§3). */
export const DISPLAY_BIAS = 0.15;
/** Probabilidad máxima de leer un escalón vecino con claridad nula. */
export const MISREAD_MAX = 0.6;

/** El rango que sugiere una ropa: el promedio de los estatus que visten así. */
export function rankOfAttire(attire: Attire, defs: readonly StatusDef[]): number | undefined {
  const ranks = defs.filter((d) => d.attire === attire).map((d) => d.rank);
  if (ranks.length === 0) return undefined;
  return ranks.reduce((a, b) => a + b, 0) / ranks.length;
}

/** Los rangos distintos de la cultura, de menor a mayor. */
function ladder(defs: readonly StatusDef[]): number[] {
  return [...new Set(defs.map((d) => d.rank))].sort((a, b) => a - b);
}

export interface ReadCues {
  /** La ropa que alcanzó a ver, si vio algo. */
  readonly attire?: Attire;
  /** 0-1: luz, distancia y atención con que miró (perception). */
  readonly clarity: number;
  /** El observador conoce a la persona de antes (familiaridad alta): sabe su lugar. */
  readonly acquainted: boolean;
}

export interface Reading {
  readonly rank: number;
  readonly confidence: number;
  readonly basis: StandingBasis;
}

/**
 * Lee la posición de alguien (§3). Conocido: el rango verdadero que la comunidad le reconoce,
 * con confianza plena. Si no, se deduce de la ropa: el escalón de lo que viste, que con poca
 * claridad se corre a un vecino (más hacia arriba si luce rico). Sin ropa visible no hay
 * lectura. Consume siempre dos sorteos de `rng`.
 */
export function readStanding(
  cues: ReadCues,
  trueRank: number | undefined,
  defs: readonly StatusDef[],
  rng: Random,
): Reading | undefined {
  const shiftRoll = rng.float();
  const dirRoll = rng.float();
  if (cues.acquainted && trueRank !== undefined) {
    return { rank: trueRank, confidence: 1, basis: "known" };
  }
  if (cues.attire === undefined) return undefined;
  const base = rankOfAttire(cues.attire, defs);
  if (base === undefined) return undefined;
  const steps = ladder(defs);
  let idx = steps.reduce(
    (best, r, i) => (Math.abs(r - base) < Math.abs((steps[best] as number) - base) ? i : best),
    0,
  );
  const misread = shiftRoll < (1 - Math.max(0, Math.min(1, cues.clarity))) * MISREAD_MAX;
  if (misread) {
    const up =
      dirRoll <
      0.5 +
        (standingOf(cues.attire) === "high" ? DISPLAY_BIAS : 0) -
        (standingOf(cues.attire) === "low" ? DISPLAY_BIAS : 0);
    idx = Math.max(0, Math.min(steps.length - 1, idx + (up ? 1 : -1)));
  }
  const rank = steps[idx] as number;
  return { rank, confidence: ATTIRE_CONFIDENCE * (0.5 + 0.5 * cues.clarity), basis: "attire" };
}

/** Qué creía `observer` de `about`, si lo leyó alguna vez. */
export function beliefAbout(
  beliefs: StandingBeliefs | undefined,
  about: AgentId,
): StandingBelief | undefined {
  return beliefs?.beliefs.find((b) => b.about === about);
}

/**
 * Incorpora una lectura nueva: lo conocido de siempre manda; entre deducciones gana la más
 * confiable, y la menos confiable solo mueve un poco el rango. Orden canónico por `about`.
 */
export function updateBeliefs(
  prev: StandingBeliefs | undefined,
  about: AgentId,
  reading: Reading,
  at: Tick,
  originEventId: EventId,
): StandingBeliefs {
  const old = beliefAbout(prev, about);
  let next: StandingBelief;
  if (!old || reading.basis === "known" || reading.confidence >= old.confidence) {
    next = { about, ...reading, seenAt: at, originEventId };
  } else {
    const w = reading.confidence / (reading.confidence + old.confidence);
    next = { ...old, rank: old.rank + (reading.rank - old.rank) * w, seenAt: at };
  }
  const rest = (prev?.beliefs ?? []).filter((b) => b.about !== about);
  return {
    beliefs: [...rest, next].sort((a, b) => (a.about < b.about ? -1 : a.about > b.about ? 1 : 0)),
  };
}
