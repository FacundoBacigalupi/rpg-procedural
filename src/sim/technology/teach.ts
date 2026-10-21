// Aprender un proceso con un maestro o de un manual (technology §2; skills §3, §10). Pura: quien
// llama decide quién enseña a quién, cuántas horas y qué evento lo causa; acá solo se calcula qué
// queda en la cabeza y en las manos del que aprende.
//
// - Con maestro se aprenden la fidelidad y la mano, despacio y juntas. La fidelidad se acerca a la
//   del maestro menos un error de copia (un paso omitido, una proporción mal leída) que se sortea
//   con `rng.fork("tech", proceso, aprendiz, evento)` y que un maestro claro achica. La mano nunca
//   pasa del techo del aprendiz (talento, edad) ni de lo que sabe, ni de la del maestro.
// - Un manual da fidelidad pero poca mano, y menos cuanto más tácito es el oficio: la forja casi
//   no se aprende de un libro.
// - Un maestro que guarda el secreto no lo enseña si no quiere.

import { type AgentId, type EventId, exp, type Rng, type Tick } from "../../core/index.ts";
import { ageFactor, CEILING_MEAN, CEILING_PER_SD, RATE_PER_SD } from "../skills/index.ts";
import type { ProcessKnowledge } from "./knowledge.ts";
import type { TechProcessDef } from "./process.ts";

/** Por debajo de esta mano un artesano no sabe enseñar (calibración abierta). */
export const TEACH_MIN_SKILL = 0.2;
/** La fidelidad se aprende en esta fracción de las horas que lleva la mano. */
export const FIDELITY_HOURS_SHARE = 0.5;
/** El error de copia máximo por lección con un maestro opaco (clarity 0). */
export const COPY_ERROR_MAX = 0.12;
/** Cuánto de la fidelidad de un texto se pierde por cada unidad de tacitez del oficio. */
export const TEXT_TACIT_LOSS = 0.6;
/** Cuánta mano da un manual, como fracción de lo que dejaría un maestro, antes de la tacitez. */
export const MANUAL_SKILL_SHARE = 0.25;
/** Un manual se lee más lento que una lección: las horas valen esta fracción. */
export const MANUAL_EFFICIENCY = 0.5;
/** Una lección o un manual de menos horas que esto no deja nada. */
export const MIN_LESSON_HOURS = 0.01;

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/** Quien aprende. */
export interface Student {
  readonly id: AgentId;
  /** Talento en desvíos de la población (`standardize`). */
  readonly talent: number;
  /** Años; por defecto un adulto de 30. */
  readonly ageYears?: number;
  /** Lo que ya sabía de este proceso, si algo. */
  readonly existing?: ProcessKnowledge;
}

export interface LessonContext {
  readonly rng: Rng;
  /** El evento de la lección: queda como `source` del saber, la causa. */
  readonly event: EventId;
  readonly tick: Tick;
}

export interface Lesson {
  readonly teacherId: AgentId;
  readonly teacher: ProcessKnowledge;
  readonly hours: number;
  /** Cuán bien explica, 0-1; por defecto sale de la mano del maestro. */
  readonly clarity?: number;
  /** Si el maestro que guarda el secreto quiere enseñarlo a este aprendiz. */
  readonly willing?: boolean;
}

export interface Manual {
  /** Cuánto de la receta real dice el texto, 0-1 (las copias lo van bajando). */
  readonly fidelity: number;
  readonly hours: number;
  /** Cuánto lee el lector, 0-1: sin lectura un manual no dice nada. */
  readonly reading: number;
}

export type RefusedReason = "secret" | "unskilled" | "no-time" | "illiterate";

export type Learned =
  | { readonly kind: "refused"; readonly reason: RefusedReason }
  | {
      readonly kind: "learned";
      readonly knowledge: ProcessKnowledge;
      /** Lo que subió la fidelidad y la mano en esta sesión, para quien narra o registra. */
      readonly gain: { readonly fidelity: number; readonly skill: number };
      /** Cuánto se perdió en la copia (0 si el aprendiz ya tenía más que lo que se perdió). */
      readonly copyError: number;
    };

/** El techo de mano del aprendiz en este proceso: talento y edad, nunca más que lo que sabe. */
export function studentCeiling(student: Student, fidelity: number): number {
  const base = clamp(CEILING_MEAN + CEILING_PER_SD * student.talent, 0.1, 1);
  return Math.min(fidelity, base * ageFactor("execution", student.ageYears ?? 30));
}

const paceOf = (student: Student) => Math.max(0.2, 1 + RATE_PER_SD * student.talent);

/** Un maestro claro achica el error; sin dato, sale de su mano. */
export function clarityOf(lesson: Pick<Lesson, "teacher" | "clarity">): number {
  return clamp(lesson.clarity ?? lesson.teacher.skill, 0, 1);
}

/** Aprender un proceso de un maestro durante `hours` horas. */
export function teachProcess(
  def: TechProcessDef,
  lesson: Lesson,
  student: Student,
  ctx: LessonContext,
): Learned {
  if (lesson.hours < MIN_LESSON_HOURS) return { kind: "refused", reason: "no-time" };
  if (lesson.teacher.skill < TEACH_MIN_SKILL) return { kind: "refused", reason: "unskilled" };
  if (lesson.teacher.secret && !lesson.willing) return { kind: "refused", reason: "secret" };

  const before = student.existing ?? null;
  const f0 = before?.fidelity ?? 0;
  const s0 = before?.skill ?? 0;
  const rng = ctx.rng.fork("tech", def.id, student.id, ctx.event);

  // El error se sortea siempre (mismo consumo de rng haya o no ganancia).
  const copyError = rng.float() * COPY_ERROR_MAX * (1 - clarityOf(lesson));
  const fTarget = Math.max(0, lesson.teacher.fidelity - copyError);
  const pace = paceOf(student);
  const fShare = 1 - exp((-lesson.hours * pace) / (def.learnHours * FIDELITY_HOURS_SHARE));
  const f1 = f0 + Math.max(0, fTarget - f0) * fShare;

  const sTarget = Math.min(lesson.teacher.skill, studentCeiling(student, f1));
  const sShare = 1 - exp((-lesson.hours * pace) / def.learnHours);
  const s1 = s0 + Math.max(0, sTarget - s0) * sShare;

  return {
    kind: "learned",
    knowledge: {
      process: def.id,
      fidelity: f1,
      skill: Math.min(s1, f1),
      source: ctx.event,
      taughtBy: lesson.teacherId,
      secret: lesson.teacher.secret,
      learnedAt: ctx.tick,
    },
    gain: { fidelity: f1 - f0, skill: Math.min(s1, f1) - s0 },
    copyError,
  };
}

/** Aprender de un texto: fidelidad con tope por lo tácito, y poca mano. */
export function learnFromManual(
  def: TechProcessDef,
  manual: Manual,
  student: Student,
  ctx: LessonContext,
): Learned {
  if (manual.hours < MIN_LESSON_HOURS) return { kind: "refused", reason: "no-time" };
  if (manual.reading <= 0) return { kind: "refused", reason: "illiterate" };

  const before = student.existing ?? null;
  const f0 = before?.fidelity ?? 0;
  const s0 = before?.skill ?? 0;
  const rng = ctx.rng.fork("tech", def.id, student.id, ctx.event);

  // Lo que se lee mal también falla: un lector flojo copia peor que uno bueno.
  const copyError = rng.float() * COPY_ERROR_MAX * (1 - manual.reading);
  const fCap = Math.max(0, manual.fidelity * (1 - TEXT_TACIT_LOSS * def.tacitness) - copyError);
  const pace = paceOf(student) * manual.reading * MANUAL_EFFICIENCY;
  const fShare = 1 - exp((-manual.hours * pace) / (def.learnHours * FIDELITY_HOURS_SHARE));
  const f1 = f0 + Math.max(0, fCap - f0) * fShare;

  const sCap = Math.min(f1, studentCeiling(student, f1)) * MANUAL_SKILL_SHARE * (1 - def.tacitness);
  const sShare = 1 - exp((-manual.hours * pace) / def.learnHours);
  const s1 = s0 + Math.max(0, sCap - s0) * sShare;

  return {
    kind: "learned",
    knowledge: {
      process: def.id,
      fidelity: f1,
      skill: Math.min(s1, f1),
      source: ctx.event,
      secret: false,
      learnedAt: ctx.tick,
    },
    gain: { fidelity: f1 - f0, skill: Math.min(s1, f1) - s0 },
    copyError,
  };
}
