// Hábitos (npc-psychology §2, Fase 2): lo que alguien hizo repetidamente. No se asignan: salen de las
// acciones registradas. Cada hábito es una fuerza 0-1 que sube con cada repetición (con rendimiento
// decreciente: 1 - fuerza) y se enfría sola con una vida media si deja de hacerlo; el decaimiento es
// perezoso, se calcula al leer. Al asentarse (cruzar `settledAt` hacia arriba) un hábito puede dejar
// un estímulo formativo: quien siembra todos los días termina creyendo que el esfuerzo rinde.
//
// Hoy se alimenta de los verbos del catálogo y de la rutina. Mentir y meditar llegan con sus
// verbos (diálogo con mentiras; cultivo). Que las decisiones y la reputación lean los hábitos
// ("siempre ayuda a los mendigos") es de los sistemas que los usan.

import {
  contentId,
  defineContent,
  type EventId,
  exp,
  LN2,
  type Tick,
  z,
} from "../../core/index.ts";
import { table } from "../world/index.ts";
import { THEMES } from "./mind.ts";

const DAY = 86_400;

export const HabitDef = z.strictObject({
  id: contentId,
  species: contentId,
  name: z.string().min(1),
  /** Verbos del catálogo que lo alimentan (eventos `action.<verbo>`). */
  verbs: z.array(contentId).default([]),
  /** Otros tipos de evento que lo alimentan (como `routine.harvested`). */
  kinds: z.array(z.string().min(1)).default([]),
  /** Cuánto sube la fuerza con cada repetición (a fuerza 0). */
  gain: z.number().positive().max(1),
  /** Días de mundo para que la fuerza baje a la mitad si no se repite. */
  halfLifeDays: z.number().positive(),
  /** Fuerza desde la que ya es un hábito (antes es una racha). */
  settledAt: z.number().gt(0).max(1).default(0.5),
  /** Lo que deja al asentarse, en el lenguaje de los esquemas. */
  stimulus: z
    .strictObject({ theme: z.enum(THEMES), intensity: z.number().min(0).max(1) })
    .optional(),
});
export type HabitDef = z.infer<typeof HabitDef>;
export const HABITS_CONTENT = defineContent("habits", HabitDef);

export interface HabitHold {
  readonly strength: number;
  /** Último momento en que se tocó (la fuerza está medida ahí). */
  readonly updated: Tick;
  /** Veces que se repitió en la vida (no decae). */
  readonly reps: number;
  /** Los últimos eventos que lo alimentaron. */
  readonly causes: readonly EventId[];
}

/** Los hábitos de una persona, por id. */
export interface Habits {
  readonly holds: Readonly<Record<string, HabitHold>>;
}

export const HABITS = table<Habits>("mind.habits");

/** Eventos que se guardan como causa de un hábito. */
export const MAX_HABIT_CAUSES = 6;

const round = (x: number) => Math.round(x * 1e6) / 1e6;

/** La fuerza de un hábito al momento `now`, ya enfriada. */
export function habitStrength(hold: HabitHold | undefined, def: HabitDef, now: Tick): number {
  if (!hold) return 0;
  const elapsed = Math.max(0, now - hold.updated);
  return round(hold.strength * exp((-LN2 * elapsed) / (def.halfLifeDays * DAY)));
}

/** Si `hold` ya es un hábito (no una racha) al momento `now`. */
export function isSettled(hold: HabitHold | undefined, def: HabitDef, now: Tick): boolean {
  return habitStrength(hold, def, now) >= def.settledAt;
}

/** Los hábitos que alimenta un evento: por verbo (`action.<verbo>`) o por tipo exacto. */
export function habitsFed(defs: readonly HabitDef[], kind: string): HabitDef[] {
  return defs.filter(
    (d) =>
      d.kinds.includes(kind) ||
      (kind.startsWith("action.") && d.verbs.includes(kind.slice("action.".length))),
  );
}

export interface Reinforced {
  readonly hold: HabitHold;
  /** Si con esta repetición cruzó `settledAt` hacia arriba (el hábito se asentó). */
  readonly settled: boolean;
}

/** Una repetición: enfría hasta `now`, suma con rendimiento decreciente y cita el evento. */
export function reinforce(
  hold: HabitHold | undefined,
  def: HabitDef,
  now: Tick,
  event: EventId,
): Reinforced {
  const before = habitStrength(hold, def, now);
  const strength = round(before + def.gain * (1 - before));
  return {
    hold: {
      strength,
      updated: now,
      reps: (hold?.reps ?? 0) + 1,
      causes: [...(hold?.causes ?? []), event].slice(-MAX_HABIT_CAUSES),
    },
    settled: before < def.settledAt && strength >= def.settledAt,
  };
}

/** Los hábitos asentados de alguien al momento `now`, del más fuerte al más débil. */
export function settledHabits(
  habits: Habits | undefined,
  defs: readonly HabitDef[],
  now: Tick,
): { readonly def: HabitDef; readonly strength: number }[] {
  const out: { def: HabitDef; strength: number }[] = [];
  for (const def of defs) {
    const s = habitStrength(habits?.holds[def.id], def, now);
    if (s >= def.settledAt) out.push({ def, strength: s });
  }
  return out.sort((a, b) => b.strength - a.strength || (a.def.id < b.def.id ? -1 : 1));
}

/** Aplica una repetición a los hábitos dados y dice cuáles se asentaron con ella. */
export function reinforceAll(
  habits: Habits | undefined,
  defs: readonly HabitDef[],
  now: Tick,
  event: EventId,
): { readonly habits: Habits; readonly settled: HabitDef[] } {
  const holds: Record<string, HabitHold> = { ...(habits?.holds ?? {}) };
  const settled: HabitDef[] = [];
  for (const def of defs) {
    const r = reinforce(holds[def.id], def, now, event);
    holds[def.id] = r.hold;
    if (r.settled) settled.push(def);
  }
  return { habits: { holds }, settled };
}
