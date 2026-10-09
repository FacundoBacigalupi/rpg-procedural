// El estado de las habilidades de una persona (skills §2), el techo (§4.2) y la curva (§4.1).
//
// Los niveles van de 0 (nunca lo hizo) a 1 (lo que ningún mortal alcanza): ~0,25 es competente,
// ~0,5 oficial, ~0,75 maestro. El techo no se guarda: se recalcula de las aptitudes innatas, las
// capacidades del cuerpo y la edad, y nadie lo ve fuera del inspector. La práctica sube el nivel
// por la forma cerrada de dL/dh = g·(1 − L/C)^k, así un tramo largo (un mes de la infancia, una
// mañana de trabajo) da lo mismo que muchos chicos y nunca pasa el techo. Si el nivel quedó
// arriba del techo (perdió una mano, envejeció) la práctica lo baja hacia él, rápido al principio.

import { exp, pow, type Tick } from "../../core/index.ts";
import type { CapabilityKey } from "../actions/index.ts";
import { table } from "../world/index.ts";
import { BODILY_FACETS, type FacetKey, type SkillDef, type VerbSkill } from "./catalog.ts";

export interface FacetState {
  /** El nivel real, 0-1 (verdad). */
  readonly level: number;
  /** El máximo alcanzado: lo que se recupera rápido después de una pausa (Fase 3). */
  readonly peak: number;
}

export interface SkillState {
  readonly facets: Readonly<Partial<Record<FacetKey, FacetState>>>;
  /** Horas de práctica acumuladas (ya multiplicadas por la intensidad del verbo). */
  readonly hours: number;
  readonly lastPracticed: Tick | null;
  /** Con qué está acostumbrado (§2.3); ausente si con nada. */
  readonly familiarities?: readonly Familiarity[];
}

/** Las habilidades de un agente, por id de habilidad. Solo las que alguna vez practicó. */
export type Skills = Readonly<Record<string, SkillState>>;

/** La tabla de `sim/skills` en la verdad, por `AgentId`. */
export const SKILL_STATE = table<Skills>("skills.state");

/** Lo que el techo y la velocidad necesitan saber de quien aprende. */
export interface Learner {
  /** Rasgos innatos en desvíos de la población (`standardize`). */
  readonly z: Readonly<Record<string, number>>;
  /** Capacidades del cuerpo, 0-1; las que faltan valen 1. */
  readonly capabilities: Readonly<Partial<Record<CapabilityKey, number>>>;
  readonly ageYears: number;
}

/** Techo de una persona de talento promedio, adulta y sana (calibración abierta). */
export const CEILING_MEAN = 0.7;
/** Cuánto sube el techo por desvío de talento. */
export const CEILING_PER_SD = 0.12;
/** Cuánto acelera el aprendizaje un desvío de talento. */
export const RATE_PER_SD = 0.25;
/** Por hora de práctica, la fracción del exceso sobre el techo que se pierde. */
export const OVER_CEILING_DECAY = 0.01;

/** El talento para una habilidad: sus aptitudes ponderadas, en desvíos. */
export function talent(def: SkillDef, z: Learner["z"]): number {
  let sum = 0;
  let norm = 0;
  for (const a of def.aptitudes) {
    sum += a.weight * (z[a.trait] ?? 0);
    norm += a.weight * a.weight;
  }
  return sum / Math.sqrt(norm);
}

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/** Cuánto del techo adulto tiene alguien de esa edad (maduración y vejez), por faceta. */
export function ageFactor(facet: FacetKey, ageYears: number): number {
  // Madura entre los 3 y los 20 años.
  const t = clamp((ageYears - 3) / 17, 0, 1);
  const grown = 0.35 + 0.65 * t * t * (3 - 2 * t);
  // La vejez baja lo del cuerpo antes y más fuerte; el juicio no baja (§4.2).
  const old = BODILY_FACETS.includes(facet)
    ? 1 - 0.012 * Math.max(0, ageYears - 40)
    : facet === "reading"
      ? 1 - 0.006 * Math.max(0, ageYears - 55)
      : 1;
  return grown * clamp(old, 0.1, 1);
}

/** La plasticidad de la etapa (npc-psychology): los chicos aprenden más rápido. */
export function plasticity(ageYears: number): number {
  if (ageYears < 12) return 1.4;
  if (ageYears < 25) return 1.4 - (0.4 * (ageYears - 12)) / 13;
  if (ageYears < 70) return 1 - (0.4 * (ageYears - 25)) / 45;
  return 0.6;
}

/** El techo real de una faceta (§4.2): aptitudes × cuerpo × edad. Verdad oculta. */
export function ceilingOf(def: SkillDef, facet: FacetKey, who: Learner): number {
  const base = clamp(CEILING_MEAN + CEILING_PER_SD * talent(def, who.z), 0.25, 0.98);
  let body = 1;
  if (BODILY_FACETS.includes(facet)) {
    for (const [cap, w] of Object.entries(def.capabilities)) {
      body *= pow(clamp(who.capabilities[cap as CapabilityKey] ?? 1, 0, 1), w);
    }
  }
  return base * body * ageFactor(facet, who.ageYears);
}

/** Nivel por hora de práctica ideal al empezar, para esta persona a esta edad. */
export function learningRate(def: SkillDef, who: Learner): number {
  return (
    def.curve.rate * clamp(1 + RATE_PER_SD * talent(def, who.z), 0.4, 2) * plasticity(who.ageYears)
  );
}

export function levelOf(state: SkillState | undefined, facet: FacetKey): number {
  return state?.facets[facet]?.level ?? 0;
}

/** El nivel efectivo para un verbo (§11): las facetas que pide, con sus pesos. 0 si nunca practicó. */
export function effectiveLevel(skills: Skills | undefined, use: VerbSkill): number {
  const state = skills?.[use.skill.id];
  let sum = 0;
  for (const [f, w] of Object.entries(use.weights)) sum += w * levelOf(state, f as FacetKey);
  return sum;
}

/** Un tramo de práctica de una habilidad. */
export interface PracticeDeposit {
  /** Pesos de las facetas que intervinieron (suman 1). */
  readonly weights: Readonly<Partial<Record<FacetKey, number>>>;
  /** Horas de práctica (ya con la intensidad). */
  readonly hours: number;
  /** Cuánto le enseñó lo que percibió, por faceta, 0 a ~1,5 (`feedbackOf`). */
  readonly feedback: Readonly<Partial<Record<FacetKey, number>>>;
  /** Cuán cerca del borde estuvo, 0-1 (`challengeFit`). */
  readonly fit: number;
  readonly tick: Tick;
}

/** La forma cerrada de dL/dh = g·(1 − L/C)^k durante h horas. */
function climb(level: number, ceiling: number, g: number, hours: number, k: number): number {
  const u0 = ceiling > 0 ? 1 - level / ceiling : 0;
  if (u0 <= 0) return level;
  const s = (g / ceiling) * hours;
  const u = k === 1 ? u0 * exp(-s) : pow(pow(u0, 1 - k) + (k - 1) * s, 1 / (1 - k));
  return ceiling * (1 - u);
}

/** Aplica un tramo de práctica (§3.1). Devuelve el estado nuevo. */
export function practice(
  def: SkillDef,
  state: SkillState | undefined,
  who: Learner,
  dep: PracticeDeposit,
): SkillState {
  const rate = learningRate(def, who);
  const facets: Partial<Record<FacetKey, FacetState>> = { ...state?.facets };
  for (const facet of def.facets) {
    const w = dep.weights[facet] ?? 0;
    if (w <= 0) continue;
    const prev = facets[facet] ?? { level: 0, peak: 0 };
    const ceiling = ceilingOf(def, facet, who);
    const hours = dep.hours * w;
    let level: number;
    if (prev.level > ceiling) {
      // Arriba del techo: la práctica lo baja hacia él (más rápido cuanto más lejos).
      level = ceiling + (prev.level - ceiling) * exp(-OVER_CEILING_DECAY * hours);
    } else {
      const g = rate * (dep.feedback[facet] ?? 0) * dep.fit;
      level = g > 0 ? climb(prev.level, ceiling, g, hours, def.curve.k) : prev.level;
    }
    facets[facet] = { level, peak: Math.max(prev.peak, level) };
  }
  return { facets, hours: (state?.hours ?? 0) + dep.hours, lastPracticed: dep.tick };
}

// --- Familiaridad (skills §2.3) --------------------------------------------------------------

/** Con qué está acostumbrado alguien: un rival, un estilo, un material, un terreno. */
export interface Familiarity {
  /** La clave de lo conocido: `rival:<agentId>`, `style:<id>`, `material:<id>`... */
  readonly with: string;
  /** El nivel que tenía en `at`, 0-1. */
  readonly level: number;
  readonly at: Tick;
}

/** Cuánto sube por exposición cada hora de contacto (de la brecha que le falta, calibración abierta). */
export const FAMILIARITY_RATE = 0.6;
/** Los días en que se pierde la mitad (se pierde rápido, §2.3; calibración abierta). */
export const FAMILIARITY_HALF_LIFE_DAYS = 60;

/** La clave de la familiaridad con el estilo de un rival concreto. */
export const rivalKey = (id: string): string => `rival:${id}`;

/** La clave de la familiaridad con un estilo (de una cultura, una escuela): lo común a muchos. */
export const styleKey = (id: string): string => `style:${id}`;
/** Cuánto de la exposición a una persona queda también en su estilo (calibración abierta). */
export const STYLE_SHARE = 0.5;

/** La familiaridad con `key` al tiempo `now`, ya con lo que se olvidó. `day` = ticks por día. */
export function familiarityOf(
  state: SkillState | undefined,
  key: string,
  now: Tick,
  day: number,
): number {
  const f = state?.familiarities?.find((x) => x.with === key);
  if (!f) return 0;
  const days = Math.max(0, now - f.at) / day;
  return f.level * pow(0.5, days / FAMILIARITY_HALF_LIFE_DAYS);
}

/** Expone a `key` durante `hours` horas: la familiaridad sube hacia 1 y se anota cuándo. */
export function exposeTo(
  state: SkillState | undefined,
  key: string,
  hours: number,
  now: Tick,
  day: number,
): SkillState {
  const base: SkillState = state ?? { facets: {}, hours: 0, lastPracticed: null };
  const cur = familiarityOf(base, key, now, day);
  const level = 1 - (1 - cur) * exp(-FAMILIARITY_RATE * Math.max(0, hours));
  const rest = (base.familiarities ?? []).filter((x) => x.with !== key);
  return { ...base, familiarities: [...rest, { with: key, level, at: now }] };
}

/** La mayor familiaridad entre varias claves (la persona, su estilo): lo que ayuda a leer al rival. */
export function familiarWith(
  state: SkillState | undefined,
  keys: readonly string[],
  now: Tick,
  day: number,
): number {
  return keys.reduce((m, k) => Math.max(m, familiarityOf(state, k, now, day)), 0);
}

/**
 * Expone a una persona y, si se conoce, a su estilo (con `STYLE_SHARE` de las horas): conocer a
 * alguien acostumbra también a cómo pelea o trabaja su gente.
 */
export function exposeToPerson(
  state: SkillState | undefined,
  person: string,
  style: string | undefined,
  hours: number,
  now: Tick,
  day: number,
): SkillState {
  const one = exposeTo(state, rivalKey(person), hours, now, day);
  return style === undefined ? one : exposeTo(one, styleKey(style), hours * STYLE_SHARE, now, day);
}
