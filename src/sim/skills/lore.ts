// El saber explícito es creencia (skills §2.4): la faceta `knowledge` de una habilidad no es un
// número suelto sino lo que alguien cree del dominio ("el ginseng de cien años cura la fiebre de
// invierno"), cada creencia con su confianza y su fuente. Algunas son falsas. El número de la
// faceta se deriva: suma lo que acierta (confianza × peso) y resta lo que cree mal, y se recalcula
// cada vez que cambian las creencias. Al usar el saber, lo equivocado resta (`lorePenalty`).
//
// Es puro. Los hechos del dominio (`LoreFact`: la afirmación y si es verdad en este mundo) los
// pone quien llama (el contenido del dominio o la ley del mundo); acá solo viven las creencias.

import type { Tick } from "../../core/index.ts";
import { table } from "../world/index.ts";
import type { SkillDef } from "./catalog.ts";
import { ceilingOf, type Learner, type SkillState } from "./state.ts";

/** Una afirmación del dominio y si es verdad en este mundo. Es la verdad: nadie la ve. */
export interface LoreFact {
  readonly id: string;
  /** Id de la habilidad a la que pertenece. */
  readonly skill: string;
  /** Si la afirmación es cierta. */
  readonly truth: boolean;
  /** Cuánto importa para el dominio (lo útil pesa más que la curiosidad), > 0. */
  readonly weight: number;
}

/** De dónde sacó una creencia. */
export type LoreSource =
  | { readonly kind: "own"; readonly tick: Tick }
  | { readonly kind: "watched"; readonly from: string; readonly tick: Tick }
  | { readonly kind: "told"; readonly from: string; readonly tick: Tick }
  | { readonly kind: "text"; readonly work: string; readonly tick: Tick };

/** Lo que alguien cree de una afirmación. */
export interface LoreBelief {
  readonly fact: string;
  /** Si cree que la afirmación es cierta (puede creer que no lo es). */
  readonly holds: boolean;
  /** Cuán seguro está, 0-1. */
  readonly confidence: number;
  readonly learnedAt: Tick;
  /** Las últimas fuentes, la más nueva al final. */
  readonly sources: readonly LoreSource[];
}

export interface Lore {
  readonly beliefs: readonly LoreBelief[];
}

/** El saber explícito de cada agente, por `AgentId`. */
export const LORE = table<Lore>("skills.lore");

/** Cuánto confía en cada tipo de fuente antes de contrastarla (calibración abierta). */
export const SOURCE_TRUST: Readonly<Record<LoreSource["kind"], number>> = {
  own: 0.9,
  watched: 0.6,
  told: 0.45,
  text: 0.55,
};
/** Cuántas fuentes se guardan por creencia. */
export const LORE_MAX_SOURCES = 4;
/** Cuánto pesa lo equivocado frente a lo acertado al medir el saber (calibración abierta). */
export const WRONG_WEIGHT = 1;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const round = (x: number) => Math.round(x * 1e6) / 1e6;

/** Si lo que cree es correcto: coincide con la verdad del hecho. */
export function isCorrect(b: LoreBelief, fact: LoreFact): boolean {
  return b.holds === fact.truth;
}

/**
 * Incorpora lo aprendido de una fuente. Una creencia por afirmación: si coincide con la que ya
 * tiene, la confianza sube hacia la de la fuente; si la contradice, se resta y, si la fuente
 * pesa más, se da vuelta. `strength` (0-1) es qué tan convincente fue la ocasión (qué tanto vio,
 * qué tan buena es la explicación).
 */
export function learnLore(
  lore: Lore | undefined,
  fact: string,
  holds: boolean,
  source: LoreSource,
  strength: number,
): Lore {
  const incoming = clamp01(SOURCE_TRUST[source.kind] * clamp01(strength));
  const beliefs = lore?.beliefs ?? [];
  const prev = beliefs.find((b) => b.fact === fact);
  let next: LoreBelief;
  if (!prev) {
    next = {
      fact,
      holds,
      confidence: round(incoming),
      learnedAt: source.tick,
      sources: [source],
    };
  } else {
    const sources = [...prev.sources, source].slice(-LORE_MAX_SOURCES);
    if (prev.holds === holds) {
      const confidence = round(prev.confidence + (1 - prev.confidence) * incoming);
      next = { ...prev, confidence, learnedAt: source.tick, sources };
    } else {
      const diff = prev.confidence - incoming;
      next =
        diff >= 0
          ? { ...prev, confidence: round(diff), learnedAt: source.tick, sources }
          : { fact, holds, confidence: round(-diff), learnedAt: source.tick, sources };
    }
  }
  return { beliefs: [...beliefs.filter((b) => b.fact !== fact), next] };
}

/**
 * Lo que se percibió de cómo resultó una afirmación al usarla (`worked`): contrasta lo que cree
 * con el resultado. Probar una receta falsa y ver que no anda baja esa creencia; ver que anda
 * una que creía sube. Si no tenía creencia, la forma con lo visto.
 */
export function testLore(
  lore: Lore | undefined,
  fact: string,
  worked: boolean,
  tick: Tick,
  strength: number,
): Lore {
  return learnLore(lore, fact, worked, { kind: "own", tick }, strength);
}

/** Los hechos del dominio de una habilidad. */
export const factsOf = (facts: readonly LoreFact[], skill: string): LoreFact[] =>
  facts.filter((f) => f.skill === skill);

/**
 * La medida derivada del saber explícito, 0-1: lo que acierta (confianza × peso) menos lo que
 * cree mal, sobre el peso de todo el dominio. Lo que no sabe no suma ni resta.
 */
export function loreMeasure(
  lore: Lore | undefined,
  facts: readonly LoreFact[],
  skill: string,
): number {
  const domain = factsOf(facts, skill);
  const total = domain.reduce((s, f) => s + f.weight, 0);
  if (total <= 0) return 0;
  let sum = 0;
  for (const f of domain) {
    const b = lore?.beliefs.find((x) => x.fact === f.id);
    if (!b) continue;
    sum += (isCorrect(b, f) ? 1 : -WRONG_WEIGHT) * b.confidence * f.weight;
  }
  return clamp01(sum / total);
}

/**
 * Lo que restan las creencias equivocadas al usar el saber (0-1) en un uso que depende de
 * `used` (los hechos que entran en la tarea): el peso de lo mal creído con su confianza, sobre
 * el peso de lo usado. Si cree algo falso con seguridad, lo aplica y falla.
 */
export function lorePenalty(
  lore: Lore | undefined,
  facts: readonly LoreFact[],
  used: readonly string[],
): number {
  let wrong = 0;
  let total = 0;
  for (const id of used) {
    const f = facts.find((x) => x.id === id);
    if (!f) continue;
    total += f.weight;
    const b = lore?.beliefs.find((x) => x.fact === id);
    if (b && !isCorrect(b, f)) wrong += b.confidence * f.weight;
  }
  return total > 0 ? clamp01(wrong / total) : 0;
}

/**
 * El saber explícito efectivo al usarlo: el nivel de la faceta menos lo que restan las
 * creencias equivocadas de la tarea (nunca por debajo de 0).
 */
export function effectiveKnowledge(level: number, penalty: number): number {
  return Math.max(0, level * (1 - penalty) - penalty * 0.25);
}

/**
 * Recalcula la faceta `knowledge` desde las creencias (§2.4): el nivel es la medida, sin pasar
 * del techo de la persona, y el pico se conserva. Si la habilidad no tiene faceta de saber, no
 * toca nada.
 */
export function syncKnowledge(
  def: SkillDef,
  state: SkillState | undefined,
  lore: Lore | undefined,
  facts: readonly LoreFact[],
  who: Learner,
): SkillState | undefined {
  if (!def.facets.includes("knowledge")) return state;
  const level = Math.min(loreMeasure(lore, facts, def.id), ceilingOf(def, "knowledge", who));
  const base: SkillState = state ?? { facets: {}, hours: 0, lastPracticed: null };
  const prev = base.facets.knowledge;
  return {
    ...base,
    facets: {
      ...base.facets,
      knowledge: { level: round(level), peak: Math.max(prev?.peak ?? 0, round(level)) },
    },
  };
}
