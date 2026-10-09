// Después de la pelea (combat.md §11, npc-psychology §12 trauma): la culpa por matar y el trauma son
// condiciones con causa, no una tirada. Esta parte pura calcula cuánto pesan para quien lo vivió
// (matar a quien no se defendía, a alguien cercano o sin necesidad pesa más; la defensa propia, creer
// que la fuerza vale, ser audaz o la costumbre, menos) y devuelve estímulos formativos que
// `mind.form` aplica. No decide nada del mundo: las condiciones mentales llegan con su propio ítem.

import type { FormativeStimulus } from "../mind/index.ts";

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const round = (x: number) => Math.round(x * 1e6) / 1e6;

export interface KillFacts {
  /** Si el muerto ya no se defendía (rendido, caído, de espaldas). */
  readonly defenseless: boolean;
  /** 0-1: cercanía con el muerto (cariño, familiaridad). */
  readonly closeness: number;
  /** Si lo hizo para salvar su vida o la de alguien. */
  readonly selfDefense: boolean;
  /** 0-1: cuánto condena la cultura este caso (código, tabú, ley). */
  readonly condemned: number;
  /** 0-1: había alternativa y lo sabía (podía perdonar). */
  readonly hadChoice: number;
  /** 0-1: cuán gráfica fue la muerte. */
  readonly gore: number;
  /** Veces que ya mató antes (la costumbre embota, no borra). */
  readonly priorKills: number;
}

export interface KillerTraits {
  /** Rasgos en desvíos estándar: `boldness`, `reactivity`, `empathy`. */
  readonly z: Readonly<Record<string, number>>;
  /** Fuerza (0-1) de los esquemas: `strength_is_worth`. */
  readonly schemas: Readonly<Record<string, number>>;
  /** 0-1: apoyo que tuvo después (quien lo escucha, el rito de la cultura). */
  readonly support?: number;
}

export interface KillAftermath {
  /** 0-1: culpa (moral). */
  readonly guilt: number;
  /** 0-1: trauma. Sale de intensidad × falta de apoyo, modulado por temperamento. */
  readonly trauma: number;
  /** Lo que `form` aplica. */
  readonly stimuli: readonly FormativeStimulus[];
}

/** Cuánto embota cada muerte previa a la culpa y al trauma, y su tope. */
export const HABITUATION = 0.08;
export const HABITUATION_CAP = 0.5;

const sd = (traits: KillerTraits, k: string) => Math.max(-2, Math.min(2, traits.z[k] ?? 0));
const sch = (traits: KillerTraits, k: string) => clamp01(traits.schemas[k] ?? 0);

/** Culpa y trauma de quien mató (combat §11, "después de la pelea"). */
export function killAftermath(facts: KillFacts, who: KillerTraits): KillAftermath {
  const numb = Math.min(HABITUATION_CAP, HABITUATION * Math.max(0, facts.priorKills));
  const base =
    0.25 +
    0.3 * clamp01(facts.closeness) +
    0.25 * (facts.defenseless ? 1 : 0) +
    0.2 * clamp01(facts.condemned) +
    0.15 * clamp01(facts.hadChoice) -
    (facts.selfDefense ? 0.55 : 0);
  const conscience = 1 + 0.2 * sd(who, "empathy") - 0.15 * sch(who, "strength_is_worth");
  const guilt = clamp01(base * conscience * (1 - numb));
  // Trauma: lo vivido (sangre, miedo a morir) × falta de apoyo después.
  const intensity = clamp01(0.15 + 0.5 * clamp01(facts.gore) + (facts.selfDefense ? 0.35 : 0.1));
  const react = 1 + 0.25 * sd(who, "reactivity") - 0.2 * Math.max(0, sd(who, "boldness"));
  const trauma = clamp01(intensity * react * (1 - 0.5 * clamp01(who.support ?? 0)) * (1 - numb));
  const stimuli: FormativeStimulus[] = [];
  if (trauma > 0.05) stimuli.push({ theme: "violence", intensity: round(trauma) });
  if (guilt > 0.05) stimuli.push({ theme: "injustice", intensity: round(guilt * 0.6) });
  return { guilt: round(guilt), trauma: round(trauma), stimuli };
}
