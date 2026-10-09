// Defectos de receta y lo que el maestro corrige (crafts §11). Un defecto es una forma concreta
// en que la tanda se apartó del punto, leída del trabajo real; el maestro mira lo que el aprendiz
// hizo (con sus propios sentidos, no con la verdad) y señala los que ve. Puro: sin rng; el error
// de lectura lo pone quien llama.

import type { RecipeDef } from "./recipe.ts";
import type { Hands, SessionResult, WorkState } from "./session.ts";

export type RecipeDefectKind = "raw" | "dry" | "scorched" | "slow" | "fire_unsteady";

export interface RecipeDefect {
  readonly kind: RecipeDefectKind;
  /** 0-1: cuánto pesa en la calidad. */
  readonly severity: number;
}

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/** Los defectos reales de lo que quedó, del más grave al menos. */
export function defectsOf(recipe: RecipeDef, r: SessionResult): RecipeDefect[] {
  const out: RecipeDefect[] = [];
  const w: WorkState = r.work;
  if (w.doneness < 0.95) out.push({ kind: "raw", severity: clamp(1 - w.doneness, 0, 1) });
  if (w.doneness > 1.1) out.push({ kind: "dry", severity: clamp(w.doneness - 1, 0, 1) });
  if (w.scorch > 0.05) out.push({ kind: "scorched", severity: clamp(w.scorch, 0, 1) });
  if (r.cookMinutes > recipe.heat.minutes * 1.6) {
    out.push({ kind: "slow", severity: clamp(r.cookMinutes / (recipe.heat.minutes * 4), 0, 1) });
  }
  if (r.corrections > recipe.heat.minutes * 0.6) {
    out.push({
      kind: "fire_unsteady",
      severity: clamp(r.corrections / (recipe.heat.minutes * 2), 0, 1),
    });
  }
  return out.sort((a, b) => b.severity - a.severity);
}

/**
 * Los defectos que el maestro nota: ve los de severidad mayor que lo que sus sentidos esconden
 * (`0,4 * (1 - senses)`). Con buenos sentidos nota casi todo; con malos, solo lo grueso.
 */
export function noticedBy(defects: readonly RecipeDefect[], master: Hands): RecipeDefect[] {
  const threshold = 0.4 * (1 - master.senses);
  return defects.filter((d) => d.severity > threshold);
}

/**
 * Qué parte de lo señalado el aprendiz incorpora: sube con el juicio del maestro (explica bien) y
 * baja con la severidad no resuelta por falta de práctica propia (`apprenticeSkill`, 0-1).
 */
export function correctionGain(master: Hands, apprenticeSkill: number): number {
  return clamp(0.15 + 0.5 * master.judgment + 0.2 * clamp(apprenticeSkill, 0, 1), 0, 0.9);
}
