// Lo que el narrador necesita saber del personaje para hablar como él (narration §4): qué
// conceptos del vocabulario del mundo cree (de sus habilidades y de lo que descubrió de la ley) y
// con qué voz mira (cultura de la aldea, estudio, oficio). Todo sale de lo que el personaje sabe
// de sí; nada de la verdad oculta del mundo. La conversión a `LexiconView`/`VoiceView` vive en
// `llm/voice` (esta capa no importa `llm`): acá se arman los datos planos que esa capa consume.

import type { AgentId } from "../../core/index.ts";
import {
  LAW_BELIEFS,
  levelOf,
  MENTAL,
  type ReadonlyWorldTruth,
  SKILL_STATE,
  type SkillCatalog,
  type SkillDef,
  STATUS,
  type StatusDef,
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

/** Ánimos que la voz sabe tintear (subconjunto de `VoiceMood` de `llm`). */
export type VoiceMoodName = "calm" | "fear" | "guilt";

/** Gravedad desde la que una condición mental tiñe la voz. */
export const MOOD_FROM_SEVERITY = 0.15;

/**
 * El ánimo de fondo del personaje: la condición mental más grave (trauma tiñe de miedo, culpa de
 * culpa). Sin condiciones que pasen el umbral no hay ánimo marcado. Empate: el id menor.
 */
export function moodOf(truth: ReadonlyWorldTruth, who: AgentId): VoiceMoodName | undefined {
  const state = truth.get(MENTAL, who);
  let best: { kind: "trauma" | "guilt"; severity: number } | undefined;
  for (const c of state?.conditions ?? []) {
    if (c.severity < MOOD_FROM_SEVERITY) continue;
    if (best === undefined || c.severity > best.severity) best = c;
  }
  return best === undefined ? undefined : best.kind === "trauma" ? "fear" : "guilt";
}

/**
 * El estrato desde el estatus que la aldea le reconoce: el que depende es pobre, el de arriba
 * (terrateniente) pesa como letrado, el resto común. Sin estatus conocido, común.
 */
export function stratumOf(
  truth: ReadonlyWorldTruth,
  who: AgentId,
  statuses: readonly StatusDef[],
): CharacterVoiceData["stratum"] {
  const holding = truth.get(STATUS, who);
  const role = statuses.find((d) => d.id === holding?.status)?.role;
  return role === "dependent" ? "poor" : role === "holder" ? "learned" : "common";
}

/** Datos planos de la voz (misma forma que `VoiceInput` de `llm`). */
export interface CharacterVoiceData {
  readonly culture: string;
  readonly stratum: "poor" | "common" | "learned" | "noble";
  readonly mood?: VoiceMoodName;
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
 * y lenguas), el oficio en que más rinde, el estrato desde su estatus y el ánimo desde sus
 * condiciones mentales.
 */
export function characterVoiceData(
  truth: ReadonlyWorldTruth,
  skills: SkillCatalog,
  who: AgentId,
  statuses: readonly StatusDef[] = [],
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
    stratum: stratumOf(truth, who, statuses),
    education,
    ...(moodOf(truth, who) !== undefined ? { mood: moodOf(truth, who) as VoiceMoodName } : {}),
    ...(best ? { trade: { name: best.def.name, notices: NOTICES[best.def.domain] ?? [] } } : {}),
  };
}
