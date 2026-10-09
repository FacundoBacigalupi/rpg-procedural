// El maestro que corrige la tanda (crafts §11, skills §3): cuando alguien cocina con un adulto de su
// casa delante que sabe más del oficio, el maestro mira lo que quedó con sus propios sentidos
// (`noticedBy` sobre los defectos reales, `defectsOf`) y le señala lo que ve; el aprendiz incorpora
// una parte (`correctionGain`: sube con el juicio del maestro y baja con la poca práctica propia) como
// feedback de la sesión. Si el maestro no nota nada (sentidos toscos, defectos finos), no enseña
// nada. Puro sobre la verdad: devuelve los cambios de habilidades y qué señaló.

import type { AgentId, PlanetClock, Tick } from "../../core/index.ts";
import {
  BODY_STATE,
  type BodyPlanDef,
  capabilitiesOf,
  challengeFit,
  correctionGain,
  ENTITY,
  handsOf,
  INNATE,
  LOCATION,
  noticedBy,
  PERSON,
  practice,
  type ReadonlyWorldTruth,
  type RecipeDefect,
  SKILL_STATE,
  type SkillCatalog,
  type Skills,
  type StateChange,
  setComponent,
  standardize,
  TEACHER_AGE,
  type Trait,
  verbSkill,
} from "../../sim/index.ts";

/** Cuánto más debe saber el maestro del oficio que quien cocina para corregirlo. */
export const MASTER_MARGIN = 0.1;

export interface CorrectionInput {
  readonly truth: ReadonlyWorldTruth;
  readonly catalog: SkillCatalog;
  readonly traits: readonly Trait[];
  readonly plans: ReadonlyMap<string, BodyPlanDef>;
  readonly clock: PlanetClock;
  readonly cook: AgentId;
  /** El verbo de oficio que se ejecutó (`cook`). */
  readonly verb: string;
  /** Los defectos reales de la tanda. */
  readonly defects: readonly RecipeDefect[];
  readonly hex: number;
  readonly seconds: number;
  /** El margen esperado del paso (para qué tan cerca del borde estuvo); null si no se tiró. */
  readonly expected: number | null;
  readonly now: Tick;
  /** Las habilidades de quien cocina ya con lo que aprendió del paso (si no, las del mundo). */
  readonly skills?: Skills | undefined;
}

export interface Correction {
  readonly master: AgentId;
  /** Los defectos que el maestro señaló. */
  readonly noticed: readonly RecipeDefect[];
  /** Qué parte de lo señalado incorporó el aprendiz. */
  readonly gain: number;
  readonly changes: StateChange[];
}

/** El maestro presente: del mismo hogar, adulto, despierto, con el oficio claramente por encima. */
export function masterOf(i: CorrectionInput): { id: AgentId; level: number } | null {
  const me = i.truth.get(PERSON, i.cook);
  if (!me) return null;
  const mine = verbSkill(i.catalog, i.truth.get(SKILL_STATE, i.cook), i.verb);
  let best: { id: AgentId; level: number } | null = null;
  for (const id of i.truth.ids(PERSON) as AgentId[]) {
    if (id === i.cook) continue;
    const p = i.truth.get(PERSON, id);
    if (!p || p.household !== me.household) continue;
    if (i.truth.get(ENTITY, id)?.endedAt !== undefined) continue;
    if (i.truth.get(LOCATION, id)?.hex !== i.hex) continue;
    if (i.truth.get(BODY_STATE, id)?.activity === "sleep") continue;
    if ((i.now - p.born) / i.clock.year < TEACHER_AGE) continue;
    const level = verbSkill(i.catalog, i.truth.get(SKILL_STATE, id), i.verb);
    if (level < mine + MASTER_MARGIN) continue;
    if (best === null || level > best.level) best = { id, level };
  }
  return best;
}

/** Lo que el maestro corrige de esta tanda y lo que el aprendiz se lleva, o null si nada. */
export function masterCorrects(i: CorrectionInput): Correction | null {
  if (i.defects.length === 0 || i.seconds <= 0) return null;
  const use = i.catalog.forVerb(i.verb);
  if (!use) return null;
  const master = masterOf(i);
  if (!master) return null;
  const masterZ = standardizeOf(i, master.id);
  const hands = handsOf(master.level, masterZ ?? {});
  const noticed = noticedBy(i.defects, hands);
  if (noticed.length === 0) return null;
  const skills = i.skills ?? i.truth.get(SKILL_STATE, i.cook);
  const gain = correctionGain(hands, verbSkill(i.catalog, skills, i.verb));
  const learner = learnerOf(i, i.cook);
  if (!learner) return null;
  const id = use.skill.id;
  const next = practice(use.skill, skills?.[id], learner, {
    weights: use.weights,
    hours: (i.seconds / 3600) * use.intensity,
    feedback: Object.fromEntries(use.skill.facets.map((f) => [f, gain])),
    fit: i.expected === null ? 0.7 : challengeFit(i.expected),
    tick: i.now,
  });
  return {
    master: master.id,
    noticed,
    gain,
    changes: [setComponent(SKILL_STATE, i.cook, { ...skills, [id]: next })],
  };
}

function standardizeOf(i: CorrectionInput, id: AgentId): Record<string, number> | null {
  const innate = i.truth.get(INNATE, id);
  const person = i.truth.get(PERSON, id);
  if (!innate || !person) return null;
  return standardize(innate, i.traits, person.sex);
}

function learnerOf(i: CorrectionInput, id: AgentId) {
  const person = i.truth.get(PERSON, id);
  const body = i.truth.get(BODY_STATE, id);
  const plan = body ? i.plans.get(body.plan) : undefined;
  const z = standardizeOf(i, id);
  if (!person || !body || !plan || !z) return null;
  return {
    z,
    capabilities: capabilitiesOf(plan, body),
    ageYears: (i.now - person.born) / i.clock.year,
  };
}
