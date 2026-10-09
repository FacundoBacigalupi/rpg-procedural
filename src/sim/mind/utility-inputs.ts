// Los insumos de la utilidad, desde el estado (npc-psychology §7): las necesidades salen del
// cuerpo (hambre de las reservas, sed del agua que falta, sueño de la deuda y el cansancio, dolor
// de las heridas) y del ánimo (el miedo empuja la seguridad, la soledad la compañía); los valores
// de `valuesOf` con el sesgo de la cultura; el temple del `Innate`; y la etapa de vida que
// reescala el peso de cada impulso. Puro: recibe el estado ya leído.

import { type Body, type BodyPlanDef, impairment } from "../body/index.ts";
import type { Innate } from "../family/index.ts";
import type { Mind, SchemaDef, StageDef, ValueDef, ValueId } from "./mind.ts";
import { valuesOf } from "./mind.ts";
import type { Drives, Needs, UtilityTemper } from "./utility.ts";

/** El ánimo del momento: lo que la memoria y la emoción le dan a las necesidades. */
export interface MoodInput {
  /** 0-1: el miedo de ahora (percepción de peligro, heridas recientes). */
  readonly fear?: number;
  /** Horas desde que estuvo con alguien que le importa. */
  readonly aloneHours?: number;
  /** 0-1: el ansia de una sustancia (`acuteEffects(...).craving`); sin ella, 0. */
  readonly craving?: number;
  /** 0-1: dolor que una sustancia deja de sentir (`acuteEffects(...).numbing`). */
  readonly numbing?: number;
}

/** Horas a solas desde las que la compañía apremia del todo (sin calibrar). */
export const LONELY_HOURS = 96;
/** El agua que falta (fracción de la masa, en litros) con la que la sed apremia del todo. */
export const THIRST_SEVERE = 0.06;
/** Horas de deuda de sueño que se sienten como urgencia 1. */
export const SLEEP_DEBT_FULL = 24;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const r = (x: number) => Math.round(x * 1e6) / 1e6;

/** Las necesidades como las siente el cuerpo y el ánimo, 0 (saciada) a 1 (apremia). */
export function needsFrom(plan: BodyPlanDef, body: Body, mood: MoodInput = {}): Needs {
  const ph = plan.physiology;
  const scale = body.massKg / ph.refMassKg;
  const shortReserve = 1 - body.glycogen / (ph.glycogenKcal * scale);
  const fatLow = 1 - body.fat / (body.massKg * ph.fatFraction * 7700);
  const hunger = clamp01(Math.max(0.8 * shortReserve, fatLow));
  const thirst = clamp01(body.water / (THIRST_SEVERE * body.massKg));
  const rest = clamp01(Math.max(body.sleepDebt / SLEEP_DEBT_FULL, body.fatigue));
  const pain = clamp01(
    body.wounds.reduce((s, w) => Math.max(s, impairment(w)), 0) * (1 - clamp01(mood.numbing ?? 0)),
  );
  const hurt = clamp01(body.wounds.length === 0 ? 0 : 0.4 * pain + 0.3 * body.sepsis);
  const safety = clamp01(Math.max(mood.fear ?? 0, hurt));
  const social = clamp01((mood.aloneHours ?? 0) / LONELY_HOURS);
  return {
    hunger: r(hunger),
    thirst: r(thirst),
    rest: r(rest),
    pain: r(pain),
    safety: r(safety),
    social: r(social),
    ...((mood.craving ?? 0) > 0 ? { craving: r(clamp01(mood.craving ?? 0)) } : {}),
  };
}

/** La etapa de vida reescala el peso de cada necesidad y cada valor (sin entrada, queda igual). */
export function stageScaled(drives: Drives, stage: StageDef | undefined): Drives {
  const f = stage?.drives;
  if (!f) return drives;
  const needs: Record<string, number> = {};
  for (const [k, v] of Object.entries(drives.needs)) needs[k] = clamp01(v * (f[k] ?? 1));
  const values: Record<string, number> = {};
  for (const [k, v] of Object.entries(drives.values)) values[k] = v * (f[k] ?? 1);
  return { needs: needs as Needs, values: values as Drives["values"] };
}

export interface DrivesInput {
  readonly plan: BodyPlanDef;
  readonly body: Body;
  readonly mood?: MoodInput;
  readonly valueDefs: readonly ValueDef[];
  readonly schemaDefs: readonly SchemaDef[];
  readonly mind: Mind;
  readonly innate: Innate;
  /** El sesgo de valores de la cultura de la aldea (`valueBias`). */
  readonly bias?: Partial<Record<ValueId, number>>;
  readonly stage?: StageDef | undefined;
}

/** Los impulsos de alguien ahora: necesidades del cuerpo y valores con cultura, por su etapa. */
export function drivesFor(i: DrivesInput): Drives {
  const values = valuesOf(i.valueDefs, i.schemaDefs, i.mind, i.innate, i.bias ?? {});
  return stageScaled({ needs: needsFrom(i.plan, i.body, i.mood), values }, i.stage);
}

/** El temple de la decisión: la audacia del `Innate` y el miedo del ánimo. */
export function temperOf(innate: Innate, mood: MoodInput = {}): UtilityTemper {
  return { boldness: clamp01(innate["boldness"] ?? 0.5), fear: clamp01(mood.fear ?? 0) };
}
