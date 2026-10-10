// El cuerpo de un individuo en la verdad (body-health §1-§2, tier 3): reservas (sangre, agua,
// glucógeno, grasa, músculo), fatiga y deuda de sueño, la carga de infección en la sangre, la
// actividad en curso y las heridas con su etapa. Todo en unidades físicas (litros, kcal, horas)
// para que la conservación se pueda seguir y la crónica pueda decir de qué murió alguien. Nadie
// adentro del mundo lee estos números: se perciben como síntomas (`bodySigns`).

import type { AgentId, EventId, PlanetClock, Tick } from "../../core/index.ts";
import { INNATE, type Innate, PERSON, type Sex, type Trait } from "../family/index.ts";
import { ENTITY, table, type WorldTruth } from "../world/index.ts";
import type { BodyPlanDef } from "./plan.ts";

/** Cuánto se exige el cuerpo ahora (lo pone la acción en curso; dormir es la única que paga sueño). */
export const ACTIVITIES = ["sleep", "rest", "light", "moderate", "heavy"] as const;
export type Activity = (typeof ACTIVITIES)[number];

export type Consciousness = "alert" | "dazed" | "unconscious";

export const WOUND_KINDS = ["cut", "puncture", "blunt"] as const;
export type WoundKind = (typeof WOUND_KINDS)[number];

export type WoundStage = "fresh" | "inflamed" | "infected" | "healing" | "healed";

export interface Wound {
  /** Número de herida dentro del cuerpo (`nextWound`). */
  readonly id: number;
  readonly kind: WoundKind;
  readonly zone: string;
  /** 0-1: qué tejidos alcanzó (piel → músculo → hueso u órgano). */
  readonly severity: number;
  /** Litros por hora hacia afuera, a presión normal. Coagula con el tiempo. */
  readonly bleeding: number;
  readonly arterial: boolean;
  /** Litros por hora por dentro (un órgano roto): no se ve y no se venda. */
  readonly internal: number;
  readonly fracture: boolean;
  /** 0-1: la suciedad que entró (arma, suelo, tripas). */
  readonly contamination: number;
  /** 0-1: la carga de infección en la herida. */
  readonly infection: number;
  /**
   * Por hora: cuán rápido crece lo que entró, si el cuerpo no lo frena. Se tira al herirse (es lo
   * único al azar de la herida: qué bichos entraron); lo demás es física.
   */
  readonly virulence: number;
  /** 0-1: cuánto cerró. */
  readonly repair: number;
  readonly stage: WoundStage;
  readonly cleaned: boolean;
  readonly bandaged: boolean;
  readonly splinted: boolean;
  readonly at: Tick;
  /** El evento que la hizo (el golpe, la caída). */
  readonly cause: EventId;
}

/** Una marca que queda (body-health §4, secuelas visibles): por ahora solo dónde y de qué. */
export interface Scar {
  readonly zone: string;
  readonly kind: WoundKind;
  readonly severity: number;
  readonly at: Tick;
  readonly cause: EventId;
}

export const DEATH_CAUSES = [
  "exsanguination",
  "dehydration",
  "starvation",
  "sepsis",
  "brain_trauma",
  "disease",
  "hypothermia",
  "heatstroke",
  "poison",
  "malnutrition",
] as const;
export type DeathCause = (typeof DEATH_CAUSES)[number];

export interface Body {
  readonly plan: string;
  readonly massKg: number;
  /** Fracción del volumen normal de sangre. */
  readonly blood: number;
  /** Litros de agua que faltan (0: bien hidratado). */
  readonly water: number;
  /** kcal de reserva corta. */
  readonly glycogen: number;
  /** kcal de grasa. */
  readonly fat: number;
  /** 0-1: el músculo que el cuerpo todavía puede quemar sin morirse de hambre. */
  readonly muscle: number;
  /** 0-1: cansancio muscular. */
  readonly fatigue: number;
  /** Horas de sueño debidas. */
  readonly sleepDebt: number;
  /** 0-1: infección en la sangre; 1 mata. */
  readonly sepsis: number;
  readonly activity: Activity;
  readonly consciousness: Consciousness;
  /** Un golpe en la cabeza lo dejó sin sentido hasta este tick. */
  readonly stunnedUntil: Tick | null;
  readonly wounds: readonly Wound[];
  readonly scars: readonly Scar[];
  readonly nextWound: number;
  /** Hasta cuándo está calculado. */
  readonly updatedAt: Tick;
  readonly death: { readonly cause: DeathCause; readonly at: Tick } | null;
}

/** La tabla de `sim/body` en la verdad, por `AgentId`. */
export const BODY_STATE = table<Body>("body.state");

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/** Cuánto de la masa adulta tiene alguien de esa edad (crecimiento hasta los 18). */
export function growth(ageYears: number): number {
  const t = clamp(ageYears / 18, 0, 1);
  return 0.06 + 0.94 * t * t * (3 - 2 * t);
}

/** Masa en kg por talla (el cuadrado de la proporción), constitución y edad. */
export function massOf(
  plan: BodyPlanDef,
  innate: Innate,
  traits: readonly Trait[],
  sex: Sex,
  ageYears: number,
  /** Talla que dejó el hambre infantil (`heightFactor`); 1 = sin secuela. */
  heightScale = 1,
): number {
  const trait = (id: string): number | undefined => innate[id];
  const height = traits.find((t) => t.id === "height");
  const shift = sex === "male" ? (height?.maleShift ?? 0) : 0;
  const ratio = height ? (trait("height") ?? height.mean + shift) / height.mean : 1;
  const scaled = ratio * heightScale;
  const build = 1 + 0.4 * ((trait("constitution") ?? 0.5) - 0.5);
  return plan.physiology.refMassKg * scaled * scaled * build * growth(ageYears);
}

/** Un cuerpo sano, comido y descansado de esa masa. */
export function newBody(plan: BodyPlanDef, massKg: number, at: Tick): Body {
  const ph = plan.physiology;
  return {
    plan: plan.id,
    massKg,
    blood: 1,
    water: 0,
    glycogen: ph.glycogenKcal * (massKg / ph.refMassKg),
    fat: massKg * ph.fatFraction * 7700,
    muscle: 1,
    fatigue: 0,
    sleepDebt: 0,
    sepsis: 0,
    activity: "rest",
    consciousness: "alert",
    stunnedUntil: null,
    wounds: [],
    scars: [],
    nextWound: 1,
    updatedAt: at,
    death: null,
  };
}

/** Un cuerpo sano para cada persona viva de la verdad. Solo al sembrar (como `seedSkills`). */
export function seedBodies(
  truth: WorldTruth,
  plan: BodyPlanDef,
  traits: readonly Trait[],
  now: Tick,
  clock: PlanetClock,
): void {
  for (const id of truth.ids(PERSON) as AgentId[]) {
    if (truth.get(ENTITY, id)?.endedAt !== undefined) continue;
    const person = truth.get(PERSON, id);
    const innate = truth.get(INNATE, id);
    if (!person || !innate) continue;
    const age = (now - person.born) / clock.year;
    truth.set(BODY_STATE, id, newBody(plan, massOf(plan, innate, traits, person.sex, age), now));
  }
}

/** Litros de sangre de este cuerpo con el volumen normal. */
export function bloodVolume(plan: BodyPlanDef, body: Body): number {
  return body.massKg * plan.physiology.bloodPerKg;
}
