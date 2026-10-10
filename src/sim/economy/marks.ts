// Marcas y sellos de un lote (economy §6): quien hizo o garantiza el lote le pone una marca que
// dice de quién es y qué calidad afirma; otro puede falsificarla, y quien mira la verifica con
// chance según su ojo y su familiaridad con la marca verdadera. Puro: sin ledger ni rng (la tirada
// la pone quien llama); no está cableado a la aldea.

import type { AgentId, Tick } from "../../core/index.ts";

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** La marca de un lote: la verdad de quién la puso y qué tan bien hecha está. */
export interface LotMark {
  /** De quién dice ser la marca (el taller o gremio cuyo nombre lleva). */
  readonly claimedBy: AgentId;
  /** Quien la puso de verdad (igual a `claimedBy` si es auténtica). */
  readonly stampedBy: AgentId;
  readonly tick: Tick;
  /** Calidad que la marca afirma (0-1). */
  readonly claimed: number;
  /** Fidelidad al original (0-1): 1 para la auténtica, según la habilidad si es falsa. */
  readonly fidelity: number;
}

/** Marca auténtica: la pone quien la lleva. */
export function stampMark(by: AgentId, claimed: number, tick: Tick): LotMark {
  return { claimedBy: by, stampedBy: by, tick, claimed: clamp(claimed, 0, 1), fidelity: 1 };
}

export function isForged(mark: LotMark): boolean {
  return mark.claimedBy !== mark.stampedBy;
}

/** Tope de fidelidad de una falsificación: nunca es idéntica a la original. */
export const FORGERY_MAX_FIDELITY = 0.95;

/**
 * Falsificar la marca de otro: la fidelidad sale de la habilidad del falsificador (0-1) y de
 * cuánto conoce la marca original (0-1, `knowledge`: haberla visto de cerca). Monótona en ambas.
 */
export function forgeMark(
  original: LotMark,
  forger: AgentId,
  tick: Tick,
  skill: number,
  knowledge: number,
  claimed: number = original.claimed,
): LotMark {
  const fidelity = clamp(
    clamp(skill, 0, 1) * (0.3 + 0.7 * clamp(knowledge, 0, 1)),
    0,
    FORGERY_MAX_FIDELITY,
  );
  return {
    claimedBy: original.claimedBy,
    stampedBy: forger,
    tick,
    claimed: clamp(claimed, 0, 1),
    fidelity,
  };
}

/**
 * Probabilidad (0-1) de que quien mira reconozca la marca como falsa: crece con su ojo y con su
 * familiaridad con la verdadera (0-1) y cae con la fidelidad. La auténtica (fidelidad 1) da 0.
 */
export function forgeryDetectChance(fidelity: number, eye: number, familiarity: number): number {
  const sloppy = 1 - clamp(fidelity, 0, 1);
  const sharp = 0.3 * clamp(eye, 0, 1) + 0.7 * clamp(familiarity, 0, 1);
  return clamp(sloppy * (0.4 + 1.2 * sharp), 0, 1);
}

/** Resultado de verificar: si lo tomó por falsa y si la marca le inspira confianza. */
export interface MarkVerdict {
  readonly seemsForged: boolean;
  /** Cuánto cree en la calidad que afirma la marca (0-1): 0 si la tomó por falsa. */
  readonly credence: number;
}

/**
 * Verifica una marca con la tirada `roll` (0-1) del llamador: la detecta si `roll` cae bajo la
 * chance. Una marca que no se ve falsa se cree según la fama de quien dice ser (`renown`, 0-1).
 * Una auténtica nunca se toma por falsa (el falso positivo no se modela aún).
 */
export function verifyMark(
  mark: LotMark,
  eye: number,
  familiarity: number,
  renown: number,
  roll: number,
): MarkVerdict {
  const caught = roll < forgeryDetectChance(mark.fidelity, eye, familiarity);
  return { seemsForged: caught, credence: caught ? 0 : clamp(0.3 + 0.7 * renown, 0, 1) };
}
