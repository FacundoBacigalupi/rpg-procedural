// Aprender mirando (skills §3.2): ver a otro hacer algo deposita experiencia en `reading` y
// `knowledge` (el gesto y el porqué) y, si el que mira ya tiene base, un poco en `execution`. Cuánto
// entra sale de lo que se percibió (vista, atención, luz) y de cuánto más sabe quien hace que quien
// mira: no se aprende de quien sabe lo mismo o menos. Mirar a alguien también acostumbra a su
// estilo (familiaridad, §2.3). Es pura: el juego decide quién ve a quién (percepción de los
// presentes) y escribe el estado nuevo con el evento del paso.

import type { Tick } from "../../core/index.ts";
import type { FacetKey, VerbSkill } from "./catalog.ts";
import {
  exposeTo,
  type Learner,
  levelOf,
  type PracticeDeposit,
  practice,
  rivalKey,
  type SkillState,
} from "./state.ts";

/** Cuánto vale una hora mirada frente a una hora haciendo (calibración abierta). */
export const WATCH_EFFICIENCY = 0.25;
/** Lo que se percibe por debajo de esto no deja nada (de espaldas, de noche, dormido). */
export const WATCH_MIN_SEEN = 0.1;
/** El nivel de ejecución desde el cual mirar también educa la mano. */
export const WATCH_EXECUTION_BASE = 0.1;
/** Cuánto pesa la mano al mirar, frente a leer y saber. */
export const WATCH_EXECUTION_WEIGHT = 0.25;

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/** Lo que alguien vio hacer a otro. */
export interface Watched {
  /** Quién lo hacía. */
  readonly doer: string;
  /** Cuánto del hecho percibió, 0 a 1 (agudeza × atención × luz). */
  readonly seen: number;
  /** El nivel efectivo de quien lo hacía en ese verbo, 0-1. */
  readonly doerLevel: number;
  readonly seconds: number;
  readonly tick: Tick;
}

/** Lo que mirar enseña: el estado nuevo, o null si no hay nada que aprender. */
export function learnFromWatching(
  use: VerbSkill,
  state: SkillState | undefined,
  who: Learner,
  w: Watched,
  day: number,
): SkillState | null {
  if (w.seen < WATCH_MIN_SEEN || w.seconds <= 0) return null;
  const mine = Object.entries(use.weights).reduce(
    (s, [f, k]) => s + k * levelOf(state, f as FacetKey),
    0,
  );
  const gap = w.doerLevel - mine;
  if (gap <= 0) return null;
  const hours = (w.seconds / 3600) * use.intensity * WATCH_EFFICIENCY * w.seen;
  const facets = use.skill.facets;
  const weights: Partial<Record<FacetKey, number>> = {};
  for (const f of ["reading", "knowledge"] as const) {
    if (facets.includes(f)) weights[f] = 1;
  }
  if (facets.includes("execution") && levelOf(state, "execution") >= WATCH_EXECUTION_BASE) {
    weights.execution = WATCH_EXECUTION_WEIGHT;
  }
  const total = Object.values(weights).reduce((s, x) => s + x, 0);
  if (total <= 0) return null;
  for (const f of Object.keys(weights) as FacetKey[]) {
    weights[f] = (weights[f] ?? 0) / total;
  }
  // Un aprendiz ve el gesto; el que ya lee bien ve el porqué (§3.2): el saber crece con su lectura.
  const why = 0.6 + 0.8 * levelOf(state, "reading");
  const feedback: Partial<Record<FacetKey, number>> = {};
  for (const f of Object.keys(weights) as FacetKey[]) {
    feedback[f] = w.seen * (f === "knowledge" ? why : 1);
  }
  const dep: PracticeDeposit = {
    weights,
    hours,
    feedback,
    fit: clamp(0.2 + 3 * gap, 0, 1),
    tick: w.tick,
  };
  const learned = practice(use.skill, state, who, dep);
  // Mirar no es practicar: no mueve cuándo practicó por última vez.
  const kept = {
    ...learned,
    lastPracticed: state?.lastPracticed ?? null,
    hours: state?.hours ?? 0,
  };
  return exposeTo(kept, rivalKey(w.doer), hours, w.tick, day);
}
