// El tono de una opción sugerida (player-loop «Tono de las opciones»): de un vistazo, qué clase de
// cosa es. Sale del catálogo (`stakes` del verbo) y de la propia incertidumbre del actor, nunca de
// la verdad que no vio (regla 4) ni de una lista de palabras. Puro: sin mundo ni IO.

import type { ActionDef, ActionStakes, Skills } from "../../sim/index.ts";

/** De menos a más grave: si una opción cabe en dos tonos, gana el más grave. */
export const SUGGESTION_TONES = [
  "routine",
  "social",
  "need",
  "uncertain",
  "risky",
  "illicit",
  "violent",
] as const;
export type SuggestionTone = (typeof SUGGESTION_TONES)[number];

/** Horas de práctica por debajo de las cuales el verbo es poco familiar (calibración pendiente). */
export const UNFAMILIAR_HOURS = 2;
/** Solo los verbos con facilidad menor a esta se vuelven inciertos por falta de familiaridad. */
export const UNCERTAIN_EASE = 1;

const STAKES_TONE: Readonly<Record<ActionStakes, SuggestionTone>> = {
  none: "routine",
  harm: "risky",
  lethal: "violent",
  crime: "illicit",
};

/** Qué tan grave es un tono (índice en `SUGGESTION_TONES`). */
export function toneRank(t: SuggestionTone): number {
  return SUGGESTION_TONES.indexOf(t);
}

/** El más grave de varios tonos. */
export function gravest(...tones: readonly SuggestionTone[]): SuggestionTone {
  return tones.reduce((a, b) => (toneRank(b) > toneRank(a) ? b : a), "routine");
}

/**
 * ¿El actor no sabe cómo va a salir? Poca práctica de la habilidad del verbo en un verbo que no es
 * fácil. Es su incertidumbre, no el resultado real.
 */
export function isUncertain(verb: ActionDef | undefined, skills: Skills | undefined): boolean {
  if (!verb?.skill || verb.ease >= UNCERTAIN_EASE) return false;
  return (skills?.[verb.skill.id]?.hours ?? 0) < UNFAMILIAR_HOURS;
}

/**
 * El tono de una opción: el base de su clase (`base`), el de lo que está en juego en sus verbos y la
 * incertidumbre del actor; gana el más grave. Lo grave no se aplaca por saber hacerlo.
 */
export function suggestionTone(
  base: SuggestionTone,
  verbs: readonly (ActionDef | undefined)[],
  skills: Skills | undefined,
): SuggestionTone {
  const tones: SuggestionTone[] = [base];
  for (const v of verbs) {
    if (!v) continue;
    tones.push(STAKES_TONE[v.stakes]);
    if (isUncertain(v, skills)) tones.push("uncertain");
  }
  return gravest(...tones);
}

/** Las opciones graves piden un segundo toque. */
export function needsConfirmation(t: SuggestionTone): boolean {
  return t === "violent" || t === "illicit";
}

/** Clave de ícono para la UI y marca de texto para la CLI (nunca solo color). */
export const TONE_ICON: Readonly<Record<SuggestionTone, string>> = {
  routine: "dot",
  social: "speech",
  need: "drop",
  uncertain: "cloud",
  risky: "warning",
  illicit: "scales",
  violent: "skull",
};

export const TONE_MARK: Readonly<Record<SuggestionTone, string>> = {
  routine: "",
  social: "",
  need: "",
  uncertain: "[?]",
  risky: "[!]",
  illicit: "[~]",
  violent: "[x]",
};

/** Etiqueta accesible (`title`/`aria-label`). */
export const TONE_LABEL: Readonly<Record<SuggestionTone, string>> = {
  routine: "corriente",
  social: "social",
  need: "necesidad",
  uncertain: "incierto",
  risky: "peligroso",
  illicit: "ilícito",
  violent: "violento",
};
