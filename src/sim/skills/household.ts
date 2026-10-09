// La infancia elegida como intenciones del hogar (game-modes §2.3, player-loop §1): «mi padre me
// enseñó la espada» no es un número de habilidad sino lo que quería un adulto de la casa. El pedido
// (`UpbringingSpec`) se resuelve contra los adultos reales del hogar en intenciones
// (`HouseholdIntent`: quién, qué, desde qué edad, cuánto) y la infancia se simula con esa presión
// extra: las horas del maestro se suman a la práctica cotidiana y el feedback que da depende de
// cuánto sabe él (un maestro tosco enseña peor; los vicios del maestro llegan con skills §3, Fase 3).
// Un pedido que el hogar no puede cumplir se rechaza con la razón (§2.4), sin inventar a nadie.
//
// Puro y sin azar: las habilidades salen de talento, edad y curva, como `upbringingSkills`.

import type { AgentId, PlanetClock, Tick } from "../../core/index.ts";
import { contentId, z } from "../../core/index.ts";
import { SKILL_SPAN } from "../actions/index.ts";
import type { PersonRecord } from "../family/index.ts";
import type { SkillCatalog, SkillDef } from "./catalog.ts";
import { challengeFit } from "./learn.ts";
import { type Learner, levelOf, practice, type Skills } from "./state.ts";

/** Quién del hogar enseña. */
export const TeacherRole = z.enum([
  "father",
  "mother",
  "either_parent",
  "grandparent",
  "household_adult",
]);
export type TeacherRole = z.infer<typeof TeacherRole>;

/** Lo que pasó en la infancia (game-modes §2.1 `upbringing`). */
export const UpbringingSpec = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("taught"),
    skill: contentId,
    by: TeacherRole,
    fromAge: z.number().min(0).max(30),
    toAge: z.number().min(0).max(30).optional(),
    /** Horas por año que el adulto le dedica; por defecto `DEFAULT_TEACH_HOURS`. */
    hoursPerYear: z.number().positive().max(2000).optional(),
  }),
]);
export type UpbringingSpec = z.infer<typeof UpbringingSpec>;

export const DEFAULT_TEACH_HOURS = 300;
/** Edad desde la que alguien de la casa puede enseñar (la misma que criar). */
export const TEACHER_AGE = 16;

/** La intención de un adulto del hogar, ya resuelta contra gente real. */
export interface HouseholdIntent {
  readonly teacher: AgentId;
  readonly skill: string;
  readonly fromAge: number;
  readonly toAge: number;
  readonly hoursPerYear: number;
  /** Índice del pedido en el `upbringing` original (para la crónica). */
  readonly spec: number;
}

export interface Rejection {
  readonly spec: number;
  readonly reason: string;
}

/** Alguien del hogar tal como lo ve la resolución. */
export interface HouseholdMember {
  readonly id: AgentId;
  readonly person: Pick<PersonRecord, "sex" | "born" | "mother" | "father">;
}

const ageAt = (m: HouseholdMember, at: Tick, clock: PlanetClock) =>
  (at - m.person.born) / clock.year;

/**
 * Resuelve los pedidos contra el hogar del chico. `members` son los que vivían en la casa (quien
 * llama los filtra por haber nacido y no haber muerto a esa edad). Elige al primero por id entre
 * los que cumplen el rol, para que sea determinista. Los rechazos llevan la razón (§2.4).
 */
export function resolveIntents(
  specs: readonly UpbringingSpec[],
  child: HouseholdMember,
  members: readonly HouseholdMember[],
  catalog: SkillCatalog,
  clock: PlanetClock,
): { intents: HouseholdIntent[]; rejected: Rejection[] } {
  const intents: HouseholdIntent[] = [];
  const rejected: Rejection[] = [];
  const parents = [child.person.mother, child.person.father];
  const grandOf = (m: HouseholdMember) =>
    members.some(
      (p) => parents.includes(p.id) && (p.person.mother === m.id || p.person.father === m.id),
    );
  const fills = (role: TeacherRole, m: HouseholdMember): boolean => {
    if (role === "father") return m.id === child.person.father;
    if (role === "mother") return m.id === child.person.mother;
    if (role === "either_parent") return parents.includes(m.id);
    if (role === "grandparent") return grandOf(m);
    return true;
  };
  specs.forEach((s, spec) => {
    if (!catalog.skill(s.skill)) {
      rejected.push({ spec, reason: `${s.skill}: no es una habilidad de este mundo` });
      return;
    }
    const toAge = s.toAge ?? s.fromAge + 6;
    if (toAge <= s.fromAge) {
      rejected.push({ spec, reason: "la enseñanza termina antes de empezar" });
      return;
    }
    const at = child.person.born + Math.round(s.fromAge * clock.year);
    const adults = members
      .filter((m) => m.id !== child.id && ageAt(m, at, clock) >= TEACHER_AGE)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const pick = adults.find((m) => fills(s.by, m));
    if (!pick) {
      rejected.push({
        spec,
        reason: `no hay en el hogar (${s.by}) quien enseñe ${s.skill} a esa edad`,
      });
      return;
    }
    intents.push({
      teacher: pick.id,
      skill: s.skill,
      fromAge: s.fromAge,
      toAge,
      hoursPerYear: s.hoursPerYear ?? DEFAULT_TEACH_HOURS,
      spec,
    });
  });
  return { intents, rejected };
}

/** Cuán bien enseña un maestro según lo que sabe de la habilidad (0,35 si nada, hasta 1). */
export function teachingFeedback(def: SkillDef, teacher: Skills | undefined): number {
  const st = teacher?.[def.id];
  const level =
    st === undefined ? 0 : def.facets.reduce((s, f) => s + levelOf(st, f), 0) / def.facets.length;
  return Math.round((0.35 + 0.65 * Math.min(1, level)) * 1e6) / 1e6;
}

const STEPS = 12;
const BASE_FEEDBACK = 0.6;
/** La facilidad de una tarea nueva cuando la habilidad no tiene práctica cotidiana de aldea. */
const INTENT_EASE = 0.4;

/**
 * Las habilidades de un chico criado con intenciones del hogar, a la edad de `now`. Reemplaza al
 * cálculo base solo para las habilidades con intención: suma, mes a mes, las horas del adulto a la
 * práctica cotidiana. `teachers` da las habilidades de cada maestro (sin ellas, enseña como quien
 * no sabe). Las demás habilidades las deja a quien llama (`upbringingSkills`).
 */
export function intendedSkills(
  catalog: SkillCatalog,
  z: Learner["z"],
  born: Tick,
  now: Tick,
  clock: PlanetClock,
  intents: readonly HouseholdIntent[],
  teachers: ReadonlyMap<AgentId, Skills>,
): Skills {
  const out: Record<string, Skills[string]> = {};
  const ageNow = (now - born) / clock.year;
  const stepYears = 1 / STEPS;
  const ids = [...new Set(intents.map((i) => i.skill))].sort();
  for (const id of ids) {
    const def = catalog.skill(id);
    if (!def) continue;
    const mine = intents.filter((i) => i.skill === id);
    const start = Math.min(def.upbringing?.fromAge ?? Infinity, ...mine.map((i) => i.fromAge));
    const weights = Object.fromEntries(def.facets.map((f) => [f, 1 / def.facets.length]));
    let state: Skills[string] | undefined;
    for (let a = start; a < ageNow; a += stepYears) {
      const years = Math.min(stepYears, ageNow - a);
      const up = def.upbringing && a >= def.upbringing.fromAge ? def.upbringing : undefined;
      let hours = up ? up.hoursPerYear * years : 0;
      let feedback = up ? BASE_FEEDBACK : 0;
      for (const i of mine) {
        if (a < i.fromAge || a >= i.toAge) continue;
        const h = i.hoursPerYear * years;
        const fb = teachingFeedback(def, teachers.get(i.teacher));
        feedback = (feedback * hours + fb * h) / (hours + h);
        hours += h;
      }
      if (hours <= 0) continue;
      const level = def.facets.reduce((s, f) => s + (state?.facets[f]?.level ?? 0), 0);
      const expected = (up?.ease ?? INTENT_EASE) + (SKILL_SPAN * level) / def.facets.length;
      state = practice(
        def,
        state,
        { z, capabilities: {}, ageYears: a + years / 2 },
        {
          weights,
          hours,
          feedback: Object.fromEntries(def.facets.map((f) => [f, feedback])),
          fit: challengeFit(expected),
          tick: born + Math.round((a + years) * clock.year),
        },
      );
    }
    if (state) out[id] = state;
  }
  return out;
}
