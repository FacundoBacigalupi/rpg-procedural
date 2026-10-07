// Configuración de la capa LLM (narration §1, §7): qué proveedor hace cada trabajo y cómo se
// narra. Es parte de lo que se elige al empezar (`NewGameSetup.narration` y `.llm`, game-modes
// §1), pero no del replay: cambiar de proveedor cambia la prosa, nunca el mundo.

import { z } from "../core/index.ts";

/** Los trabajos del LLM (narration §1), cada uno con su prompt, su validador y sus proveedores. */
export const LlmJob = z.enum([
  "parser",
  "narrator",
  "verbalizer",
  "clarify",
  "montage",
  "inworld_text",
  "dream",
  "chronicle",
  "ooc",
]);
export type LlmJob = z.infer<typeof LlmJob>;
export const LLM_JOBS: readonly LlmJob[] = LlmJob.options;

export const LlmProvider = z.discriminatedUnion("kind", [
  /** Plantillas deterministas (narration §11): siempre disponibles. */
  z.strictObject({ kind: z.literal("templates") }),
  /** Un modelo abierto en la PC del usuario, por la interfaz compatible con OpenAI. */
  z.strictObject({
    kind: z.literal("local"),
    runtime: z.enum(["ollama", "llamacpp", "lmstudio"]),
    model: z.string().min(1),
    /** Restringir la salida estructurada con el JSON Schema del esquema Zod. */
    grammar: z.boolean().optional(),
    /** Si el servidor no está en el puerto de siempre. */
    baseUrl: z.url().optional(),
  }),
  /** Opcional, pago por uso; la clave sale del entorno, nunca del setup. */
  z.strictObject({
    kind: z.literal("api"),
    vendor: z.string().min(1),
    model: z.string().min(1),
    baseUrl: z.url().optional(),
    maxSpendPerSession: z.number().nonnegative().optional(),
  }),
]);
export type LlmProvider = z.infer<typeof LlmProvider>;

export const LlmConfig = z
  .strictObject({
    /** Por trabajo, en orden de preferencia; el último siempre es `templates`. */
    jobs: z.record(LlmJob, z.array(LlmProvider).min(1)),
    promptLanguage: z.enum(["en", "es"]),
    outputLanguage: z.enum(["es", "en"]),
  })
  .superRefine((c, ctx) => {
    for (const job of LLM_JOBS) {
      const chain = c.jobs[job];
      if (chain.at(-1)?.kind !== "templates") {
        ctx.addIssue({
          code: "custom",
          path: ["jobs", job],
          message: "el último proveedor tiene que ser `templates` (el juego anda sin red)",
        });
      }
    }
  });
export type LlmConfig = z.infer<typeof LlmConfig>;

/** Todo con plantillas: los tests, la sim headless y el modo sin red. */
export function offlineLlmConfig(): LlmConfig {
  const jobs = Object.fromEntries(LLM_JOBS.map((j) => [j, [{ kind: "templates" }]]));
  return LlmConfig.parse({ jobs, promptLanguage: "en", outputLanguage: "es" });
}

/** Un modelo local residente para todos los trabajos (ARCHITECTURE §7.7), con plantillas detrás. */
export function localLlmConfig(
  runtime: "ollama" | "llamacpp" | "lmstudio",
  model: string,
): LlmConfig {
  const local: LlmProvider = { kind: "local", runtime, model, grammar: true };
  const jobs = Object.fromEntries(LLM_JOBS.map((j) => [j, [local, { kind: "templates" }]]));
  return LlmConfig.parse({ jobs, promptLanguage: "en", outputLanguage: "es" });
}

/** Cómo quiere el usuario que se le cuente (narration §7, §14); produce `StyleSettings` por pedido. */
export const NarrationPrefs = z.strictObject({
  person: z.enum(["second", "first", "third"]),
  tense: z.enum(["present", "past"]),
  voseo: z.boolean(),
  detail: z.enum(["brief", "normal", "rich"]),
});
export type NarrationPrefs = z.infer<typeof NarrationPrefs>;

/** Segunda persona, presente, con voseo (narration, decisiones aprobadas). */
export const DEFAULT_NARRATION: NarrationPrefs = {
  person: "second",
  tense: "present",
  voseo: true,
  detail: "normal",
};
