// Escenarios y objetivos de calibración (tooling §6, §7): datos de `content/scenarios/` y
// `content/tuning/`. Los lee la sim headless (`src/tools/sim`); la sim en sí no los usa.

import { contentId, defineContent, z } from "../../core/index.ts";

const staple = z.strictObject({ staple: z.string().trim().min(1) });

/**
 * Subconjunto JSON-serializable de `LifeOptions` (opt-in de la vida): flags, números y cadenas.
 * Lo que lleva funciones o mapas (`waterSources`, `tradeNeeds`, `skillWage`, `abuse.chance`) queda
 * fuera: se cablea en código. Sin `life`, la aldea es la de siempre.
 */
export const ScenarioLife = z.strictObject({
  famine: staple
    .extend({ horizonDays: z.number().gt(0).optional(), refresh: z.boolean().optional() })
    .optional(),
  migration: staple.optional(),
  rumorGrievance: z.boolean().optional(),
  scam: z.boolean().optional(),
  scamFiller: z.string().trim().min(1).optional(),
  relationDecay: z.boolean().optional(),
  loanBondage: z
    .strictObject({
      wagePerDay: z.number().min(0),
      upkeepPerDay: z.number().min(0),
      maxDays: z.number().gt(0),
      ransom: z.boolean().optional(),
      onlyWithoutOtherWage: z.boolean().optional(),
    })
    .optional(),
  loanBondageAbuse: z.strictObject({ reputationCost: z.number().min(0) }).optional(),
  swapMaterials: z.boolean().optional(),
  moldHintsFromCatalog: z.boolean().optional(),
  tradeView: z
    .union([
      z.boolean(),
      z.strictObject({
        misread: z.strictObject({ chance: z.number().min(0).max(1) }).optional(),
        people: z.boolean().optional(),
      }),
    ])
    .optional(),
  marks: z.boolean().optional(),
  loanContagion: z.string().trim().min(1).optional(),
  loanContagionEffects: z.strictObject({ rateMarkup: z.number().min(0) }).optional(),
  loanWorkout: z.boolean().optional(),
});
export type ScenarioLife = z.infer<typeof ScenarioLife>;

/**
 * Un escenario de la sim headless: condiciones de arranque con nombre. Hoy fija lo que `LifeSetup`
 * ya deja elegir (modo, entrada, grilla del planeta); forzar el estado del mundo (hambruna, guerra,
 * acaparador) espera a que cada sistema declare sus condiciones iniciales (ROADMAP).
 */
export const ScenarioEntry = z.strictObject({
  id: contentId,
  name: z.string().trim().min(1),
  /** Qué prueba, en una frase. */
  description: z.string().trim().min(1),
  mode: z.enum(["realistic", "novel"]).default("realistic"),
  /** Edad de entrada del personaje (`entry: age`); sin ella, la del setup por defecto. */
  entryAge: z.number().int().min(0).max(120).optional(),
  /** Frecuencia de la grilla del planeta; sin ella, la del planeta real. */
  frequency: z.number().int().min(1).optional(),
  /** Años por defecto de la corrida. */
  years: z.number().gt(0).optional(),
  /** Opt-in de la vida a calibrar (`LifeOptions`, subconjunto serializable); sin él, la aldea por defecto. */
  life: ScenarioLife.optional(),
});
export type ScenarioEntry = z.infer<typeof ScenarioEntry>;
export const SCENARIOS = defineContent("scenarios", ScenarioEntry);

const Bound = z
  .strictObject({ min: z.number().optional(), max: z.number().optional() })
  .refine(
    (b) =>
      (b.min !== undefined || b.max !== undefined) &&
      (b.min === undefined || b.max === undefined || b.min <= b.max),
    "la tolerancia necesita `min` o `max`, y min <= max",
  );

/**
 * Un objetivo de calibración: la sensación escrita como la espera el autor y la métrica con
 * tolerancia que la traduce. `metric` es una clave plana de `flattenMetrics` (`metrics.agentsAlive`);
 * con `per` el valor es `metric / per` (tasas). Se mide con la media, el mínimo o el máximo del lote.
 */
export const TuningTargetEntry = z.strictObject({
  id: contentId,
  feel: z.string().trim().min(1),
  metric: z.string().trim().min(1),
  per: z.string().trim().min(1).optional(),
  stat: z.enum(["mean", "min", "max"]).default("mean"),
  expect: Bound,
  /** Escenario en el que se corre; sin él, el de por defecto. */
  scenario: contentId.optional(),
  /** Seeds del lote (`1..20`, `1,5,9..11`). */
  seeds: z.string().trim().min(1).default("1..5"),
  years: z.number().gt(0).default(5),
});
export type TuningTargetEntry = z.infer<typeof TuningTargetEntry>;
export const TUNING_TARGETS = defineContent("tuning", TuningTargetEntry, (t) =>
  t.scenario ? [{ kind: "scenarios", id: t.scenario, at: "scenario" }] : [],
);
