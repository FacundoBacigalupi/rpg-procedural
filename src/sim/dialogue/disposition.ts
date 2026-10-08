// Quién es el oyente y qué recuerda de quien le habla (dialogue §5, npc-psychology §1, §5): la
// respuesta no sale solo de la relación de ahora sino del temperamento (el generoso da antes, el
// reactivo se ofende antes) y de las memorias que tiene de esa persona (lo vivido con ella, con su
// saliencia y su confianza). Todo puro: se arma con lo que el oyente ya tiene, no con la verdad.

import type { AgentId, Tick } from "../../core/index.ts";
import { type Memories, memoriesAbout } from "../mind/index.ts";

/** El temperamento del oyente que pesa en la charla, de -1 a 1 (z estandarizado / 2, acotado). */
export interface Temper {
  /** Calidez: generosidad y apertura. */
  readonly warmth: number;
  /** Reactividad: qué tan rápido se ofende. */
  readonly reactivity: number;
}

export const NEUTRAL_TEMPER: Temper = { warmth: 0, reactivity: 0 };

/** Lo que el oyente recuerda de quien le habla, resumido. */
export interface Recollection {
  /** -1..1: el tono de lo vivido con esa persona (ponderado, tirando a 0 con pocos recuerdos). */
  readonly bias: number;
  /** 0-1: lo más vívido que recuerda (saliencia × intensidad). */
  readonly vivid: number;
  /** Cuántos recuerdos y resúmenes (gists) hay de esa persona. */
  readonly count: number;
}

export const NO_RECOLLECTION: Recollection = { bias: 0, vivid: 0, count: 0 };

/** Peso inerte que acerca el tono a 0 cuando hay pocos recuerdos. */
export const RECOLLECTION_PRIOR = 0.15;
/** Saliencia que se le da a lo ya comprimido en un gist (se recuerda «en general»). */
export const GIST_SALIENCE = 0.2;

export const clampTemper = (z: number): number => Math.min(1, Math.max(-1, z / 2));

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Resume lo que `listener` recuerda de `who` al momento `now`. */
export function recollect(memories: Memories | undefined, who: AgentId, now: Tick): Recollection {
  const parts: { w: number; valence: number; vivid: number }[] = [];
  for (const { memory: m, salience } of memoriesAbout(memories, who, now)) {
    parts.push({
      w: salience * (0.2 + m.intensity) * m.confidence,
      valence: m.valence,
      vivid: salience * m.intensity,
    });
  }
  for (const g of memories?.gists ?? []) {
    if (!g.with.includes(who)) continue;
    const reach = GIST_SALIENCE * g.peak;
    parts.push({ w: reach * Math.min(g.count, 5), valence: g.valence, vivid: reach });
  }
  if (parts.length === 0) return NO_RECOLLECTION;
  const total = parts.reduce((s, p) => s + p.w, 0);
  const bias = parts.reduce((s, p) => s + p.w * p.valence, 0) / (total + RECOLLECTION_PRIOR);
  return {
    bias: Math.round(Math.min(1, Math.max(-1, bias)) * 1e6) / 1e6,
    vivid: Math.round(clamp01(Math.max(...parts.map((p) => p.vivid))) * 1e6) / 1e6,
    count: parts.length,
  };
}
