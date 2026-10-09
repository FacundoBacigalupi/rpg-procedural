// Aprender a hablar por oír hablar (skills §3.2, §8; language §5): escuchar a otro en una lengua o
// con un acento que uno no domina deposita en `accent` (la voz), `knowledge` (las palabras) y
// `reading` (el oído) de la habilidad de lengua. Cuanto más cerca está de lo que uno ya hace, más
// aprovecha; no se aprende de quien suena igual o peor. Pura: el juego decide quién oye a quién.

import type { Tick } from "../../core/index.ts";
import type { FacetKey, SkillDef } from "./catalog.ts";
import {
  exposeToPerson,
  type Learner,
  levelOf,
  type PracticeDeposit,
  practice,
  type SkillState,
} from "./state.ts";

/** Cuánto vale una hora oída frente a una hablada (calibración abierta). */
export const HEAR_EFFICIENCY = 0.2;
/** Lo que se oyó con menos claridad que esto no deja nada. */
export const HEAR_MIN_CLEAR = 0.15;

export interface HeardSpeech {
  readonly speaker: string;
  /** Cuánto se oyó y entendió, 0-1 (oído × atención × ruido). */
  readonly clarity: number;
  /** Cuán bien hablaba quien se oyó (su faceta de acento o su acento nativo), 0-1. */
  readonly speakerLevel: number;
  readonly seconds: number;
  readonly tick: Tick;
  /** Su acento o variedad, si se lo reconoce: uno se acostumbra a esa voz. */
  readonly style?: string;
}

/** Lo que oír enseña: el estado nuevo, o null si no hay nada que aprender. */
export function learnFromHearing(
  def: SkillDef,
  state: SkillState | undefined,
  who: Learner,
  h: HeardSpeech,
  day: number,
): SkillState | null {
  if (h.clarity < HEAR_MIN_CLEAR || h.seconds <= 0) return null;
  const mine =
    (levelOf(state, "accent") + levelOf(state, "knowledge") + levelOf(state, "execution")) / 3;
  const gap = h.speakerLevel - mine;
  if (gap <= 0) return null;
  const facets = def.facets;
  const weights: Partial<Record<FacetKey, number>> = {};
  for (const f of ["accent", "knowledge", "reading"] as const) {
    if (facets.includes(f)) weights[f] = f === "reading" ? 0.5 : 1;
  }
  const total = Object.values(weights).reduce((s, x) => s + x, 0);
  if (total <= 0) return null;
  const feedback: Partial<Record<FacetKey, number>> = {};
  for (const f of Object.keys(weights) as FacetKey[]) {
    weights[f] = (weights[f] ?? 0) / total;
    feedback[f] = h.clarity;
  }
  const dep: PracticeDeposit = {
    weights,
    hours: (h.seconds / 3600) * HEAR_EFFICIENCY * h.clarity,
    feedback,
    fit: Math.min(1, Math.max(0, 0.2 + 3 * gap)),
    tick: h.tick,
  };
  const learned = practice(def, state, who, dep);
  // Oír no es hablar: no mueve cuándo practicó por última vez.
  const kept = {
    ...learned,
    lastPracticed: state?.lastPracticed ?? null,
    hours: state?.hours ?? 0,
  };
  return exposeToPerson(kept, h.speaker, h.style, dep.hours, h.tick, day);
}
