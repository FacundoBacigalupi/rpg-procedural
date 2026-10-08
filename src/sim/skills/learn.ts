// Aprender practicando (skills §3.1): cada paso que usa una habilidad deposita práctica en las
// facetas que pidió el verbo. Cuánto enseña sale de la autopercepción (actions §7.6): lo que el
// actor notó de su resultado y de por qué. Un error que no vio no le enseña nada (los vicios que
// eso fija llegan en la Fase 3). Se aprende más cerca del borde: con el margen esperado lejos del
// punto en que sale a veces sí y a veces no, la tarea es rutina o imposible y casi no enseña. Así
// el que ara treinta años deja de mejorar a los cinco.
//
// La siembra de la aldea usa la misma práctica: cada persona hizo, mes a mes desde chica, lo que
// hace un chico de la aldea (`upbringing`), con su talento y su edad de cada momento.

import type { AgentId, EntityRef, PlanetClock, Tick } from "../../core/index.ts";
import { exp } from "../../core/index.ts";
import { type ActionDef, type Attempt, SKILL_SPAN, standardize } from "../actions/index.ts";
import { INNATE, PERSON, type Trait } from "../family/index.ts";
import { ENTITY, type WorldTruth } from "../world/index.ts";
import type { FacetKey, SkillCatalog, SkillDef } from "./catalog.ts";
import { SELF_IMAGES, seedSelfImages } from "./selfimage.ts";
import {
  effectiveLevel,
  type Learner,
  type PracticeDeposit,
  practice,
  SKILL_STATE,
  type Skills,
} from "./state.ts";

/** El margen esperado en que más se aprende: donde sale más o menos dos de cada tres veces. */
export const LEARNING_EDGE = 0.5;
/** Cuán ancho es el borde, en desvíos (calibración abierta). */
export const LEARNING_WIDTH = 0.9;
/** Cuánto más enseña a leer y a juzgar un resultado del que el actor entendió la causa. */
export const UNDERSTOOD_BONUS = 1.4;

/** Cuán cerca del borde estuvo un paso, 0-1, por su margen esperado (§3.1, `ajuste`). */
export function challengeFit(expected: number): number {
  const d = (expected - LEARNING_EDGE) / LEARNING_WIDTH;
  return exp(-0.5 * d * d);
}

/** Lo que el actor sacó de lo que percibió de su resultado. */
export interface Feedback {
  /** 0 a 1: cuánto le enseña a la mano (y la base de las otras facetas). */
  readonly amount: number;
  /** Si sabe por qué falló (percibió lo que le jugó en contra): enseña más a leer y juzgar. */
  readonly understood: boolean;
}

/**
 * El feedback de una tirada, solo desde lo que el actor percibió (§3.1). Fracasar entendiendo
 * enseña más que acertar sin entender; un fracaso no notado no enseña; lo que no se tiró
 * (faltó un requisito) no es práctica.
 */
export function feedbackOf(roll: Attempt): Feedback {
  if (roll.margin === null) return { amount: 0, understood: false };
  const understood = roll.cues.length > 0 && roll.believed !== "success";
  let amount: number;
  switch (roll.outcome) {
    case "critical":
      amount = roll.margin > 0 ? 0.7 : 1;
      break;
    case "success":
    case "discovered":
      amount = roll.believed === "partial" ? 0.9 : 0.6;
      break;
    case "partial":
      amount = roll.believed === "partial" ? 0.9 : 0.3;
      break;
    case "failure":
      amount = understood ? 1 : 0.5;
      break;
    case "failure_suspected":
      amount = 0.25;
      break;
    case "failure_unnoticed":
      amount = 0;
      break;
  }
  return { amount, understood };
}

function perFacet(def: SkillDef, fb: Feedback): Partial<Record<FacetKey, number>> {
  const out: Partial<Record<FacetKey, number>> = {};
  for (const f of def.facets) {
    out[f] = fb.amount * (fb.understood && f !== "execution" ? UNDERSTOOD_BONUS : 1);
  }
  return out;
}

/**
 * Lo que un paso le enseña a quien lo hizo: el estado nuevo de sus habilidades, o null si no
 * cambió nada (el verbo no usa habilidad, no se tiró, o no percibió nada que le enseñe). El turno
 * lo escribe con el evento del paso (`setComponent(SKILL_STATE, actor, …)`).
 */
export function learnFromAttempt(
  catalog: SkillCatalog,
  skills: Skills | undefined,
  who: Learner,
  verb: ActionDef,
  roll: Attempt,
  seconds: number,
  tick: Tick,
): Skills | null {
  const use = catalog.forVerb(verb.id);
  if (!use || roll.expected === null) return null;
  const fb = feedbackOf(roll);
  if (fb.amount <= 0) return null;
  const dep: PracticeDeposit = {
    weights: use.weights,
    hours: (seconds / 3600) * use.intensity,
    feedback: perFacet(use.skill, fb),
    fit: challengeFit(roll.expected),
    tick,
  };
  const id = use.skill.id;
  return { ...skills, [id]: practice(use.skill, skills?.[id], who, dep) };
}

/** El nivel efectivo que pone el actor en un verbo, para `AttemptActor.skill`. */
export function verbSkill(catalog: SkillCatalog, skills: Skills | undefined, verb: string): number {
  const use = catalog.forVerb(verb);
  return use ? effectiveLevel(skills, use) : 0;
}

/** El nivel que pone el otro de la contienda, para `AttemptParty.skill`. */
export function opposingSkill(
  catalog: SkillCatalog,
  skills: Skills | undefined,
  verb: string,
): number {
  const use = catalog.opposing(verb);
  return use ? effectiveLevel(skills, use) : 0;
}

/** Cuántos tramos por año usa la siembra (la práctica de la infancia, mes a mes). */
const UPBRINGING_STEPS = 12;
/** El feedback medio de la práctica cotidiana de un chico. */
const UPBRINGING_FEEDBACK = 0.6;

/**
 * Las habilidades de alguien criado en la aldea, a la edad de `now` (la siembra de la
 * pre-corrida). Determinista y sin azar: talento, edad de cada momento y la curva hacen el resto.
 * La tarea típica se vuelve más fácil a medida que mejora (rutina), así que se estanca.
 */
export function upbringingSkills(
  catalog: SkillCatalog,
  z: Learner["z"],
  born: Tick,
  now: Tick,
  clock: PlanetClock,
): Skills {
  const out: Record<string, Skills[string]> = {};
  const ageNow = (now - born) / clock.year;
  const stepYears = 1 / UPBRINGING_STEPS;
  for (const def of catalog.skills) {
    const up = def.upbringing;
    if (!up || ageNow <= up.fromAge) continue;
    const weights = Object.fromEntries(def.facets.map((f) => [f, 1 / def.facets.length]));
    const feedback = Object.fromEntries(def.facets.map((f) => [f, UPBRINGING_FEEDBACK]));
    let state: Skills[string] | undefined;
    for (let age = up.fromAge; age < ageNow; age += stepYears) {
      const years = Math.min(stepYears, ageNow - age);
      const level = def.facets.reduce((s, f) => s + (state?.facets[f]?.level ?? 0), 0);
      const expected = up.ease + (SKILL_SPAN * level) / def.facets.length;
      const at = born + Math.round((age + years) * clock.year);
      state = practice(
        def,
        state,
        { z, capabilities: {}, ageYears: age + years / 2 },
        {
          weights,
          hours: up.hoursPerYear * years,
          feedback,
          fit: challengeFit(expected),
          tick: at,
        },
      );
    }
    if (state) out[def.id] = state;
  }
  return out;
}

/**
 * Siembra las habilidades de la gente viva de la aldea en la verdad, a partir de `PERSON` e
 * `INNATE` (lo que dejó `seedVillage`). Solo al sembrar.
 */
export function seedSkills(
  truth: WorldTruth,
  catalog: SkillCatalog,
  traits: readonly Trait[],
  now: Tick,
  clock: PlanetClock,
): void {
  for (const id of truth.ids(PERSON) as AgentId[]) {
    if (truth.get(ENTITY, id as EntityRef)?.endedAt !== undefined) continue;
    const person = truth.get(PERSON, id);
    const innate = truth.get(INNATE, id);
    if (!person || !innate) continue;
    const z = standardize(innate, traits, person.sex);
    const skills = upbringingSkills(catalog, z, person.born, now, clock);
    truth.set(SKILL_STATE, id, skills);
    truth.set(SELF_IMAGES, id, seedSelfImages(catalog, skills, z, now));
  }
}
