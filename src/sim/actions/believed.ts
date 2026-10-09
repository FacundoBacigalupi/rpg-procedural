// La chance de éxito que el actor cree tener (skills §9, actions §5): las decisiones —utilidad y
// factibilidad creída— estiman con la autoimagen de la habilidad y no con la verdad; la resolución
// (`attempt`) sigue usando la verdad. Misma cuenta que la tirada (`baseMargin`) con otro nivel de
// habilidad, sin azar ni oposición. Puro y determinista.

import { exp } from "../../core/index.ts";
import { type AttemptActor, baseMargin, type Scene, SUCCESS_MARGIN } from "./attempt.ts";
import type { ActionDef } from "./catalog.ts";
import type { PlanNode } from "./plan.ts";

/** Lo que el actor cree de su habilidad: nivel estimado y cuán seguro está (autoimagen). */
export interface SkillEstimate {
  readonly level: number;
  readonly spread: number;
}

export interface ChanceInput {
  readonly def: ActionDef;
  readonly node: Extract<PlanNode, { kind: "do" }>;
  readonly planManner: readonly string[];
  /** Rasgos y cuerpo tal como el actor los siente; `skill` se ignora (se usa la estimación). */
  readonly actor: AttemptActor;
  readonly scene: Scene;
}

export interface BelievedChance {
  /** Chance (0-1) de salir bien con la autoimagen. */
  readonly chance: number;
  /** Cota baja y alta si la habilidad fuera una dispersión menos o más de lo que cree. */
  readonly low: number;
  readonly high: number;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** La chance de que el margen llegue al umbral de éxito (logística ~ normal, como `selfimage`). */
export function successChance(expected: number): number {
  return 1 / (1 + exp(-1.7 * (expected - SUCCESS_MARGIN)));
}

/** La chance de éxito del paso para un nivel de habilidad dado (sin oposición). */
export function chanceAt(input: ChanceInput, level: number): number {
  return successChance(baseMargin(input, clamp01(level)).expected);
}

/**
 * Lo que el actor cree que puede pasar: la chance con su autoimagen y el abanico que le deja no
 * estar seguro (`spread`). Sin autoimagen (nunca la practicó) estima con nivel 0 y mucha duda.
 */
export function believedChance(
  input: ChanceInput,
  image: SkillEstimate | undefined,
): BelievedChance {
  const level = image?.level ?? 0;
  const spread = image?.spread ?? 0.3;
  return {
    chance: chanceAt(input, level),
    low: chanceAt(input, level - spread),
    high: chanceAt(input, level + spread),
  };
}

/**
 * Cuánto se pasa de optimista: la chance que cree menos la que tiene con la verdad. Positivo es
 * sobreestimarse (el que se creía mejor descubre que no lo es); lo usan el inspector y los tests.
 */
export function chanceError(input: ChanceInput, image: SkillEstimate, trueLevel: number): number {
  return chanceAt(input, image.level) - chanceAt(input, trueLevel);
}

/** Por debajo de esta chance creída el paso se siente arriesgado (calibración abierta). */
export const RISKY_BELOW = 0.25;

/**
 * Cuánto vale intentar un paso con la autoimagen: la chance creída pesa el valor del éxito contra
 * el costo del fracaso (la utilidad de npc-psychology §7 lo llama con sus propios pesos).
 */
export function expectedGain(chance: number, gain: number, loss: number): number {
  return chance * gain - (1 - chance) * loss;
}
