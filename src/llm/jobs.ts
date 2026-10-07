// Los trabajos (narration §1, §9): cada pedido va por la cadena de proveedores del trabajo, en
// orden. Una salida que no valida se regenera una vez con el error explicado; un proveedor caído
// (red, tiempo, HTTP) pasa al siguiente sin reintentar. Cuando la cadena llega a `templates`, el
// resultado lo dice y quien pidió usa la plantilla determinista (narration §11): el juego nunca
// depende de que el modelo conteste.

import type { z } from "../core/index.ts";
import {
  type Fetch,
  type LlmClient,
  LlmError,
  type LlmMessage,
  LOCAL_BASE_URLS,
  OpenAiCompatibleClient,
} from "./client.ts";
import type { LlmConfig, LlmJob, LlmProvider } from "./config.ts";

/**
 * El JSON de una salida estructurada: sin el razonamiento que algunos modelos locales escriben antes
 * (`<think>…</think>`) ni el cerco de Markdown cuando el runtime no restringe la salida.
 */
export function jsonPayload(text: string): string {
  const t = text.replace(/^\s*<think>[\s\S]*?<\/think>/, "").trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(t);
  return fenced?.[1] ?? t;
}

/** Problemas de una salida de texto; vacío es que pasa. */
export type TextValidator = (text: string) => readonly string[];

/** El validador de la Fase 0 (narration §16): todavía no rechaza nada. */
export const acceptAll: TextValidator = () => [];

export type JobResult<T> =
  | { readonly ok: true; readonly value: T; readonly provider: string; readonly attempts: number }
  | {
      readonly ok: false;
      /** Lo que hay que usar en su lugar: la plantilla, o nada si la cadena no la tiene. */
      readonly fallback: "templates";
      readonly problems: readonly string[];
    };

/** Lo que queda de cada intento, para mejorar prompts (narration §9) y medir latencias. */
export interface JobLogEntry {
  readonly job: LlmJob;
  readonly provider: string;
  readonly attempt: number;
  readonly outcome: "ok" | "invalid" | "error";
  readonly problems: readonly string[];
  readonly promptTokens?: number | undefined;
  readonly completionTokens?: number | undefined;
}

export interface LlmJobsOptions {
  readonly config: LlmConfig;
  /** El cliente de cada proveedor; `undefined` lo saltea (por ejemplo, una API sin clave). */
  readonly clientFor: (provider: LlmProvider) => LlmClient | undefined;
  readonly log?: ((entry: JobLogEntry) => void) | undefined;
  /** Cuántas veces se pide una salida válida a un mismo proveedor (narration §9: dos). */
  readonly attempts?: number | undefined;
}

export interface JobRequest {
  readonly messages: readonly LlmMessage[];
  readonly maxTokens?: number | undefined;
  readonly temperature?: number | undefined;
  readonly seed?: number | undefined;
}

export class LlmJobs {
  readonly #o: LlmJobsOptions;

  constructor(options: LlmJobsOptions) {
    this.#o = options;
  }

  /** Salida estructurada: JSON que valida contra el esquema Zod, que también la restringe. */
  structured<T>(
    job: LlmJob,
    schema: z.ZodType<T>,
    jsonSchema: { readonly name: string; readonly schema: Record<string, unknown> },
    request: JobRequest,
  ): Promise<JobResult<T>> {
    return this.#run(job, request, jsonSchema, (text) => {
      let raw: unknown;
      try {
        raw = JSON.parse(jsonPayload(text));
      } catch {
        return { problems: ["the answer is not valid JSON"] };
      }
      const parsed = schema.safeParse(raw);
      if (parsed.success) return { value: parsed.data };
      return {
        problems: parsed.error.issues.map((i) => {
          const path = i.path.map(String).join(".");
          return path ? `${path}: ${i.message}` : i.message;
        }),
      };
    });
  }

  /** Texto libre que tiene que pasar el validador del trabajo. */
  text(
    job: LlmJob,
    request: JobRequest,
    validate: TextValidator = acceptAll,
  ): Promise<JobResult<string>> {
    return this.#run(job, request, undefined, (text) => {
      const problems = validate(text);
      return problems.length === 0 ? { value: text } : { problems };
    });
  }

  async #run<T>(
    job: LlmJob,
    request: JobRequest,
    jsonSchema: { readonly name: string; readonly schema: Record<string, unknown> } | undefined,
    check: (text: string) => { value: T } | { problems: readonly string[] },
  ): Promise<JobResult<T>> {
    const { config, clientFor, log } = this.#o;
    const attempts = this.#o.attempts ?? 2;
    const problems: string[] = [];

    for (const provider of config.jobs[job]) {
      if (provider.kind === "templates") return { ok: false, fallback: "templates", problems };
      const client = clientFor(provider);
      if (!client) {
        problems.push(`${describe(provider)}: no disponible`);
        continue;
      }
      const constrain = provider.kind === "local" ? provider.grammar !== false : true;
      let messages = [...request.messages];
      for (let attempt = 1; attempt <= attempts; attempt++) {
        let text: string;
        let usage: { promptTokens?: number; completionTokens?: number } = {};
        try {
          const res = await client.complete({
            messages,
            schema: constrain ? jsonSchema : undefined,
            maxTokens: request.maxTokens,
            temperature: request.temperature,
            seed: request.seed,
          });
          text = res.text;
          usage = { ...res.usage };
        } catch (e) {
          const why = e instanceof Error ? e.message : String(e);
          problems.push(why);
          log?.({ job, provider: client.name, attempt, outcome: "error", problems: [why] });
          if (e instanceof LlmError) break; // caído: al siguiente proveedor
          throw e;
        }
        const result = check(text);
        if ("value" in result) {
          log?.({ job, provider: client.name, attempt, outcome: "ok", problems: [], ...usage });
          return { ok: true, value: result.value, provider: client.name, attempts: attempt };
        }
        log?.({
          job,
          provider: client.name,
          attempt,
          outcome: "invalid",
          problems: result.problems,
          ...usage,
        });
        problems.push(...result.problems.map((p) => `${client.name}: ${p}`));
        // Se regenera con el error explicado (narration §9).
        messages = [
          ...messages,
          { role: "assistant", content: text },
          {
            role: "user",
            content: `Your previous answer was rejected:\n- ${result.problems.join("\n- ")}\nAnswer again, fixing only that.`,
          },
        ];
      }
    }
    return { ok: false, fallback: "templates", problems };
  }
}

function describe(p: LlmProvider): string {
  if (p.kind === "templates") return "templates";
  return p.kind === "local" ? `${p.runtime}:${p.model}` : `${p.vendor}:${p.model}`;
}

export interface ClientFactoryOptions {
  readonly fetch?: Fetch | undefined;
  /** La clave de una API; sin clave, ese proveedor se saltea. */
  readonly apiKey?: ((vendor: string) => string | undefined) | undefined;
  readonly timeoutMs?: number | undefined;
}

/** Apaga el razonamiento por la interfaz compatible con OpenAI (Ollama lo respeta; `think` no). */
export const NO_THINKING = { reasoning_effort: "none" } as const;

/** Arma los clientes reales por la interfaz compatible con OpenAI. */
export function openAiClientFactory(
  options: ClientFactoryOptions = {},
): (provider: LlmProvider) => LlmClient | undefined {
  const cache = new Map<string, LlmClient>();
  return (p) => {
    if (p.kind === "templates") return undefined;
    const key = JSON.stringify(p);
    const hit = cache.get(key);
    if (hit) return hit;
    let client: LlmClient | undefined;
    if (p.kind === "local") {
      client = new OpenAiCompatibleClient(describe(p), {
        baseUrl: p.baseUrl ?? LOCAL_BASE_URLS[p.runtime],
        model: p.model,
        fetch: options.fetch,
        timeoutMs: options.timeoutMs,
        extra: p.think ? undefined : NO_THINKING,
      });
    } else {
      const apiKey = options.apiKey?.(p.vendor);
      if (!apiKey || !p.baseUrl) return undefined;
      client = new OpenAiCompatibleClient(describe(p), {
        baseUrl: p.baseUrl,
        model: p.model,
        apiKey,
        fetch: options.fetch,
        timeoutMs: options.timeoutMs,
      });
    }
    cache.set(key, client);
    return client;
  };
}
