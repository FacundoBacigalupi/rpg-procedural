// Lo que leen las demás capas del cuerpo (body-health §3, §15). La resolución de acciones y el
// techo de las habilidades leen capacidades 0-1 derivadas de las zonas heridas y de la fisiología;
// la percepción interna lee síntomas cualitativos, nunca números (el jugador no ve su `Body`).

import type { CapabilityKey } from "../actions/index.ts";
import type { DeficiencyStage, Nutrient } from "./nutrition.ts";
import { BLOOD_DAZED, BLOOD_DEATH, INFECTED } from "./physiology.ts";
import type { BodyFunction, BodyPlanDef } from "./plan.ts";
import type { Body, Wound } from "./state.ts";

export interface BodyCapabilities extends Record<CapabilityKey, number> {
  /** Pensar y atender: el dolor, la fiebre, el sueño y la sangre que falta lo bajan. */
  readonly cognition: number;
  /** Aguantar esfuerzo: fatiga, reservas y sangre. */
  readonly endurance: number;
  readonly sight: number;
  readonly hearing: number;
}

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/** Cuánto le quita una herida a su zona: la gravedad que falta cerrar, y el hueso roto. */
export function impairment(w: Wound): number {
  if (w.stage === "healed") return 0;
  const tissue = w.severity * (1 - 0.8 * w.repair);
  const bone = w.fracture ? (w.splinted ? 0.5 : 0.85) * (1 - w.repair) : 0;
  const swollen = w.stage === "infected" ? 0.2 : 0;
  return clamp(Math.max(tissue, bone) + swollen, 0, 1);
}

/** Lo que una función conserva: 1 menos lo que aporta cada zona por cuánto está dañada. */
function functionOf(plan: BodyPlanDef, body: Body, f: BodyFunction): number {
  let lost = 0;
  for (const zone of plan.zones) {
    const share = zone.functions[f] ?? 0;
    if (share === 0) continue;
    let worst = 0;
    for (const w of body.wounds) if (w.zone === zone.id) worst = Math.max(worst, impairment(w));
    lost += share * worst;
  }
  return clamp(1 - lost, 0, 1);
}

/** Las capacidades del cuerpo ahora (verdad: lo que usa la sim, no lo que el actor cree). */
export function capabilitiesOf(plan: BodyPlanDef, body: Body): BodyCapabilities {
  if (body.death || body.consciousness === "unconscious") {
    return {
      locomotion: 0,
      manipulation: 0,
      speech: 0,
      strength: 0,
      cognition: 0,
      endurance: 0,
      sight: 0,
      hearing: 0,
    };
  }
  const lethalWater = plan.physiology.lethalDehydration * body.massKg;
  const blood = clamp((body.blood - BLOOD_DEATH) / (1 - BLOOD_DEATH - 0.1), 0, 1);
  const thirst = 1 - 0.6 * clamp(body.water / lethalWater, 0, 1);
  const sleep = 1 - 0.5 * clamp((body.sleepDebt - 16) / 32, 0, 1);
  const pain = body.wounds.reduce((s, w) => Math.max(s, impairment(w)), 0);
  const fever = clamp(body.sepsis * 1.5, 0, 1);
  const dazed = body.consciousness === "dazed" ? 0.6 : 1;
  const systemic = dazed * blood * thirst * sleep * (1 - 0.3 * fever);
  const reserves = body.glycogen > 0 ? 1 : 0.85;
  const brawn = 0.4 + 0.6 * body.muscle;
  const mind = clamp(dazed * sleep * thirst * (1 - 0.3 * pain) * (1 - 0.5 * fever), 0, 1);
  return {
    locomotion: functionOf(plan, body, "locomotion") * systemic * (1 - 0.3 * body.fatigue),
    manipulation: functionOf(plan, body, "manipulation") * systemic * (1 - 0.2 * pain),
    speech: functionOf(plan, body, "speech") * Math.min(1, systemic + 0.3),
    strength:
      functionOf(plan, body, "strength") * systemic * brawn * reserves * (1 - 0.4 * body.fatigue),
    cognition: mind * functionOf(plan, body, "consciousness"),
    endurance: systemic * brawn * reserves * (1 - body.fatigue),
    sight: functionOf(plan, body, "sight") * dazed,
    hearing: functionOf(plan, body, "hearing") * dazed,
  };
}

/**
 * Lo que se siente del propio cuerpo (body-health §15): etiquetas, sin números. Perception las
 * vuelve percepts internos y el narrador las cuenta. Las de una herida van con su zona.
 */
export const BODY_SIGNS = [
  "bleeding",
  "bleeding_heavily",
  "pale",
  "dizzy",
  "thirsty",
  "parched",
  "hungry",
  "starving",
  "wasting",
  "tired",
  "exhausted",
  "sleepy",
  "feverish",
  "in_pain",
  "wound_hot",
  "bone_broken",
  "limping",
] as const;
export type BodySign = (typeof BODY_SIGNS)[number];

export interface SignReport {
  readonly general: readonly BodySign[];
  readonly zones: readonly { readonly zone: string; readonly signs: readonly BodySign[] }[];
}

/**
 * Signos por etapa de carencia (opt-in de `bodySigns`): hierro, desde la incipiente, palidez; proteína
 * franca, consunción; vitamina C franca, dolor; vitamina D grave, cojera; yodo franco, cansancio.
 */
export function deficiencySigns(
  stages: Readonly<Partial<Record<Nutrient, DeficiencyStage>>>,
): readonly BodySign[] {
  const out: BodySign[] = [];
  const at = (n: Nutrient, min: 1 | 2 | 3) => {
    const k = stages[n];
    return k === "early" ? min <= 1 : k === "overt" ? min <= 2 : k === "severe";
  };
  if (at("iron", 1)) out.push("pale");
  if (at("protein", 2)) out.push("wasting");
  if (at("vitaminC", 2)) out.push("in_pain");
  if (at("vitaminD", 3)) out.push("limping");
  if (at("iodine", 2)) out.push("tired");
  return out;
}

/**
 * `ill`: tiene una enfermedad con síntomas (body-health §6), que se ve como fiebre. `stages`: etapas
 * de carencia (opt-in; sin ellas, el resultado es el de siempre).
 */
export function bodySigns(
  plan: BodyPlanDef,
  body: Body,
  ill = false,
  stages?: Readonly<Partial<Record<Nutrient, DeficiencyStage>>>,
): SignReport {
  const general: BodySign[] = [];
  const ph = plan.physiology;
  const scale = body.massKg / ph.refMassKg;
  const add = (cond: boolean, s: BodySign) => {
    if (cond) general.push(s);
  };
  add(body.blood < 0.8, "pale");
  add(body.blood <= BLOOD_DAZED + 0.05, "dizzy");
  add(body.water > 0.025 * body.massKg, "thirsty");
  add(body.water > 0.06 * body.massKg, "parched");
  add(body.glycogen < 0.3 * ph.glycogenKcal * scale, "hungry");
  add(body.fat < 0.25 * body.massKg * ph.fatFraction * 7700, "starving");
  add(body.muscle < 0.85, "wasting");
  add(body.fatigue > 0.5, "tired");
  add(body.fatigue > 0.85, "exhausted");
  add(body.sleepDebt > 8, "sleepy");
  add(ill || body.sepsis > 0.15 || body.wounds.some((w) => w.infection > INFECTED), "feverish");
  add(
    capabilitiesOf(plan, body).locomotion < 0.7 && body.consciousness !== "unconscious",
    "limping",
  );
  if (stages) for (const sign of deficiencySigns(stages)) add(!general.includes(sign), sign);
  const zones: { zone: string; signs: BodySign[] }[] = [];
  for (const zone of plan.zones) {
    const signs: BodySign[] = [];
    for (const w of body.wounds) {
      if (w.zone !== zone.id || w.stage === "healed") continue;
      const bleeding = w.bleeding * (w.bandaged ? 0.25 : 1);
      if (bleeding > 0.5 && !signs.includes("bleeding_heavily")) signs.push("bleeding_heavily");
      else if (bleeding > 0.02 && !signs.includes("bleeding")) signs.push("bleeding");
      if (impairment(w) > 0.15 && !signs.includes("in_pain")) signs.push("in_pain");
      if (w.infection > INFECTED && !signs.includes("wound_hot")) signs.push("wound_hot");
      if (w.fracture && !signs.includes("bone_broken")) signs.push("bone_broken");
    }
    if (signs.length > 0) zones.push({ zone: zone.id, signs });
  }
  return { general, zones };
}
