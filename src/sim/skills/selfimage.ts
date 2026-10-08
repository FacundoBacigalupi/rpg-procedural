// Autoimagen de la habilidad (skills §9): lo que alguien cree que sabe hacer, aparte de lo que sabe.
// Es una creencia sobre sí mismo por habilidad: un nivel estimado con su dispersión y de dónde salió.
// Se forma de los resultados que percibió (`Attempt.believed`, no la verdad del tiro): un fracaso
// que no notó cuenta como acierto y lo infla; uno entendido lo baja. El temperamento la sesga (el
// audaz se sobreestima, el reactivo se subestima) y el principiante, que todavía no lee sus
// errores (`reading` bajo), se sobreestima más. La resolución sigue usando la verdad: quien se creía
// mejor descubre que no lo es. La opinión ajena y el saber explícito llegan con sus propios ítems.

import type { Tick } from "../../core/index.ts";
import { exp, sqrt } from "../../core/index.ts";
import type { Attempt } from "../actions/index.ts";
import { table } from "../world/index.ts";
import type { SkillCatalog, SkillDef } from "./catalog.ts";
import { levelOf, type SkillState, type Skills } from "./state.ts";

export interface SelfImage {
  /** Qué nivel (0-1) cree tener y cuán seguro está (desvío de la estimación). */
  readonly estimate: { readonly level: number; readonly spread: number };
  /** Cuántos resultados percibidos la formaron (la siembra cuenta los de toda una infancia). */
  readonly samples: number;
  readonly sources: readonly "own_results"[];
  readonly updatedAt: Tick;
}

/** Lo que cada agente cree de su propia habilidad, por id de habilidad. */
export type SelfImages = Readonly<Record<string, SelfImage>>;

/** La tabla de autoimagen en la verdad, por `AgentId` (el que cree). */
export const SELF_IMAGES = table<SelfImages>("skills.selfImage");

/** Cuánto mueve la estimación un resultado mejor o peor que lo esperado (calibración abierta). */
export const RESULT_SWING = 0.25;
/** Sesgo del temperamento por desvío de (audacia − reactividad)/2. */
export const TEMPERAMENT_BIAS_PER_SD = 0.04;
/** Sobreestimación máxima del que no sabe leer sus errores. */
export const NOVICE_OVERCONFIDENCE = 0.1;
/** Nivel de `reading` desde el cual ya no hay sobreestimación de novato. */
export const NOVICE_READING = 0.3;
/** Peso mínimo de un resultado nuevo: la experiencia vieja nunca pesa del todo. */
export const MIN_GAIN = 0.05;
/** Dispersión de quien recién empieza y piso de quien ya se conoce. */
export const SPREAD_START = 0.3;
export const SPREAD_FLOOR = 0.04;
/** Resultados percibidos que se le suponen a la siembra de una infancia de práctica. */
export const SEED_SAMPLES = 40;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const round = (x: number) => Math.round(x * 1e6) / 1e6;

/** El nivel de la habilidad: el promedio de sus facetas. */
export function skillLevel(def: SkillDef, state: SkillState | undefined): number {
  return def.facets.reduce((s, f) => s + levelOf(state, f), 0) / def.facets.length;
}

/** Cuánto se desvía de la verdad por carácter y por no ver sus errores (no depende de un tiro). */
export function selfBias(
  def: SkillDef,
  state: SkillState | undefined,
  z: Readonly<Record<string, number>>,
): number {
  const temper = (TEMPERAMENT_BIAS_PER_SD * ((z["boldness"] ?? 0) - (z["reactivity"] ?? 0))) / 2;
  const novice =
    NOVICE_OVERCONFIDENCE * (1 - Math.min(1, levelOf(state, "reading") / NOVICE_READING));
  return temper + (state === undefined ? 0 : novice);
}

function spreadFor(samples: number): number {
  return Math.max(SPREAD_FLOOR, SPREAD_START / sqrt(1 + samples / 6));
}

/** La autoimagen de alguien que practicó toda la vida sin sorpresas: su nivel más su sesgo. */
export function seedSelfImage(
  def: SkillDef,
  state: SkillState,
  z: Readonly<Record<string, number>>,
  tick: Tick,
): SelfImage {
  return {
    estimate: {
      level: round(clamp01(skillLevel(def, state) + selfBias(def, state, z))),
      spread: round(spreadFor(SEED_SAMPLES)),
    },
    samples: SEED_SAMPLES,
    sources: ["own_results"],
    updatedAt: tick,
  };
}

/** Siembra la autoimagen de todas las habilidades que alguien practicó. */
export function seedSelfImages(
  catalog: SkillCatalog,
  skills: Skills,
  z: Readonly<Record<string, number>>,
  tick: Tick,
): SelfImages {
  const out: Record<string, SelfImage> = {};
  for (const [id, state] of Object.entries(skills)) {
    const def = catalog.skill(id);
    if (def) out[id] = seedSelfImage(def, state, z, tick);
  }
  return out;
}

/** La chance de acertar que el actor siente por el margen esperado (logística ~ normal). */
function expectedSuccess(expected: number): number {
  return 1 / (1 + exp(-1.7 * expected));
}

/**
 * Lo que un paso le dice de sí mismo a quien lo hizo: la autoimagen nueva, o null si no cambió
 * (el verbo no usa habilidad, no se tiró). Solo mira lo que percibió del resultado; `skills` es el
 * estado de antes del paso (para el sesgo del principiante).
 */
export function updateSelfImage(
  catalog: SkillCatalog,
  images: SelfImages | undefined,
  skills: Skills | undefined,
  z: Readonly<Record<string, number>>,
  verb: string,
  roll: Attempt,
  tick: Tick,
): SelfImages | null {
  const use = catalog.forVerb(verb);
  if (!use || roll.expected === null) return null;
  const def = use.skill;
  const state = skills?.[def.id];
  const prev = images?.[def.id];
  const score = roll.believed === "success" ? 1 : roll.believed === "partial" ? 0.5 : 0;
  // El resultado percibido contra lo que se esperaba de una tarea así: sorprende para arriba o abajo.
  const reading =
    skillLevel(def, state) +
    RESULT_SWING * (score - expectedSuccess(roll.expected)) +
    selfBias(def, state, z);
  const samples = (prev?.samples ?? 0) + 1;
  const base = prev?.estimate.level ?? reading;
  const gain = prev === undefined ? 1 : Math.max(MIN_GAIN, 1 / (samples + 1));
  const next: SelfImage = {
    estimate: {
      level: round(clamp01(base + gain * (reading - base))),
      spread: round(spreadFor(samples)),
    },
    samples,
    sources: ["own_results"],
    updatedAt: tick,
  };
  return { ...images, [def.id]: next };
}

/** Cómo se ve a sí mismo, en palabras sin números (el panel `personaje`). */
export type SkillStanding = "hardly" | "novice" | "competent" | "skilled" | "master";

export function skillStandingOf(level: number): SkillStanding {
  if (level < 0.08) return "hardly";
  if (level < 0.2) return "novice";
  if (level < 0.4) return "competent";
  if (level < 0.62) return "skilled";
  return "master";
}
