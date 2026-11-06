// La prueba de ingreso (novel-cult-sect-trial, cultivation §3 «Medición»): en la bajada anual la secta
// mide a los chicos con un instrumento (una piedra de prueba) que lee la raíz con error, como toda
// percepción con instrumento (perception §8). La lectura es lo que la secta y el medido creen; la
// verdad sigue en `TALENT`. Acepta a quien la piedra muestra con una raíz que vale la pena: una raíz
// mixta débil se rechaza aunque en verdad sirva, y una lectura de más puede aceptar a quien no la tiene.

import type { EntityRef, Rng, Tick } from "../../core/index.ts";
import type { Innate } from "../family/index.ts";
import { table } from "../world/index.ts";
import type { CultivationLaw } from "./law.ts";
import { aptitudeOf } from "./talent.ts";

export const SECT_TRIAL_EVENT = "cultivation.sect_trial";

/** Las edades que la secta prueba: antes no se lee la raíz, después ya es tarde para empezar. */
export const TRIAL_MIN_YEARS = 8;
export const TRIAL_MAX_YEARS = 16;
/** El desvío de la piedra al leer la fuerza de la raíz y cada elemento (en la escala del rasgo). */
export const TRIAL_ROOT_SD = 0.3;
export const TRIAL_ELEMENT_SD = 0.35;
/** Desde qué calidad leída la secta acepta (una raíz sola débil pasa; tres débiles, no). */
export const TRIAL_ACCEPT_QUALITY = 0.2;
/** Qué tan seguido una casa lleva a su chico a la plaza el día de la bajada. */
export const TRIAL_BROUGHT_CHANCE = 0.6;

const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** Lo que mostró la piedra. */
export interface TrialReading {
  /** Los elementos que la piedra mostró, del más fuerte al más débil; vacío: no brilló. */
  readonly elements: readonly string[];
  /** La calidad que la secta le atribuye, 0-1. */
  readonly quality: number;
}

/** El resultado de la prueba, en quien fue medido (lo sabe: se lo dijeron en la plaza). */
export interface SectTrial {
  readonly org: EntityRef;
  readonly year: number;
  readonly at: Tick;
  readonly reading: TrialReading;
  readonly accepted: boolean;
}

export const SECT_TRIAL = table<SectTrial>("cultivation.sect_trial");

/** La lectura de la piedra: el talento con el error del instrumento, leído con la misma ley. */
export function readRoots(law: CultivationLaw, innate: Innate, rng: Rng): TrialReading {
  const noisy: Record<string, number> = { ...innate };
  noisy["spirit_root"] =
    (innate["spirit_root"] ?? Number.NEGATIVE_INFINITY) + rng.fork("root").normal(0, TRIAL_ROOT_SD);
  for (const element of law.elements) {
    const key = `root_${element}`;
    noisy[key] = (innate[key] ?? 0) + rng.fork("element", element).normal(0, TRIAL_ELEMENT_SD);
  }
  const apt = aptitudeOf(law, noisy);
  return { elements: apt.roots.map((r) => r.element), quality: round3(apt.rootQuality) };
}

export const trialAccepts = (r: TrialReading): boolean =>
  r.elements.length > 0 && r.quality >= TRIAL_ACCEPT_QUALITY;
