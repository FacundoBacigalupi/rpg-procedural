// Lo que el narrador necesita saber del personaje para hablar como él (narration §4): qué
// conceptos del vocabulario del mundo cree (de sus habilidades y de lo que descubrió de la ley) y
// con qué voz mira (cultura de la aldea, estudio, oficio). Todo sale de lo que el personaje sabe
// de sí; nada de la verdad oculta del mundo. La conversión a `LexiconView`/`VoiceView` vive en
// `llm/voice` (esta capa no importa `llm`): acá se arman los datos planos que esa capa consume.

import type { AgentId } from "../../core/index.ts";
import {
  LAW_BELIEFS,
  levelOf,
  type ReadonlyWorldTruth,
  SKILL_STATE,
  type SkillCatalog,
  type SkillDef,
  villageCulture,
} from "../../sim/index.ts";
import type { LexiconEntry } from "./content.ts";

/** Nivel mínimo en alguna faceta para decir que el personaje conoce de verdad esa habilidad. */
export const KNOWS_SKILL_AT = 0.05;

/** El vocabulario de una familia de mundo, en orden de id (determinista). */
export function lexiconOf(entries: readonly LexiconEntry[], family: string): LexiconEntry[] {
  return entries
    .filter((e) => e.family === family)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Los conceptos que el personaje cree: `skill.<id>` por cada habilidad que practicó de verdad y
 * `law.<fenómeno>` por cada regularidad de la que ya tiene creencias. Las palabras técnicas
 * entran al lexicón cuando entra su concepto.
 */
export function believedConcepts(truth: ReadonlyWorldTruth, who: AgentId): Set<string> {
  const out = new Set<string>();
  const skills = truth.get(SKILL_STATE, who);
  for (const [id, state] of Object.entries(skills ?? {})) {
    const top = Math.max(0, ...Object.keys(state.facets).map((f) => levelOf(state, f as never)));
    if (top >= KNOWS_SKILL_AT) out.add(`skill.${id}`);
  }
  const laws = truth.get(LAW_BELIEFS, who);
  for (const b of Object.values(laws?.beliefs ?? {})) {
    if (b.seen > 0) out.add(`law.${b.key.phenomenon}`);
  }
  return out;
}

/** Datos planos de la voz (misma forma que `VoiceInput` de `llm`, sin ánimo todavía). */
export interface CharacterVoiceData {
  readonly culture: string;
  readonly stratum: "poor" | "common" | "learned" | "noble";
  readonly education: number;
  readonly trade?: { readonly name: string; readonly notices: readonly string[] };
}

/** Lo que nota alguien de un oficio, por dominio de su habilidad (frases del personaje). */
const NOTICES: Readonly<Partial<Record<SkillDef["domain"], readonly string[]>>> = {
  craft: ["cómo está hecha una cosa", "el estado de las herramientas"],
  body: ["el color y el aliento de los enfermos"],
  survival: ["el rumbo del viento", "huellas en el barro"],
  social: ["quién evita mirar a quién"],
  combat: ["cómo se para la gente"],
};

/**
 * Cómo habla y mira el personaje: la cultura de su aldea, cuánto estudió (habilidades de estudio
 * y lenguas) y el oficio en que más rinde. El estrato queda `common` hasta que exista la
 * estratificación (social-structure); el ánimo vendrá de `mind.form` (ítem aparte).
 */
export function characterVoiceData(
  truth: ReadonlyWorldTruth,
  skills: SkillCatalog,
  who: AgentId,
): CharacterVoiceData {
  const state = truth.get(SKILL_STATE, who) ?? {};
  let education = 0;
  let best: { def: SkillDef; level: number } | undefined;
  for (const [id, s] of Object.entries(state)) {
    const def = skills.skill(id);
    if (!def) continue;
    const level = Math.max(0, ...Object.keys(s.facets).map((f) => levelOf(s, f as never)));
    if (def.domain === "study" || def.domain === "language") education = Math.max(education, level);
    if (
      (def.domain === "craft" || def.domain === "body" || def.domain === "survival") &&
      level >= KNOWS_SKILL_AT &&
      (best === undefined || level > best.level || (level === best.level && def.id < best.def.id))
    ) {
      best = { def, level };
    }
  }
  return {
    culture: villageCulture(truth)?.name ?? "de la aldea",
    stratum: "common",
    education,
    ...(best ? { trade: { name: best.def.name, notices: NOTICES[best.def.domain] ?? [] } } : {}),
  };
}
