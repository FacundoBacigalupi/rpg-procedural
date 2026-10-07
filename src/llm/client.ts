// El cliente de un modelo (ARCHITECTURE §7.7): una sola interfaz, `/v1/chat/completions` como
// la hablan Ollama, el servidor de llama.cpp, LM Studio y las APIs. `fetch` directo, sin SDK.
// El cliente no sabe de trabajos ni de validación: manda mensajes y devuelve texto.

export interface LlmMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface LlmRequest {
  readonly messages: readonly LlmMessage[];
  /** Salida restringida por JSON Schema (`response_format`); sin esto, texto libre. */
  readonly schema?: { readonly name: string; readonly schema: Record<string, unknown> } | undefined;
  readonly maxTokens?: number | undefined;
  readonly temperature?: number | undefined;
  /** Para que el mismo pedido dé el mismo texto donde el runtime lo respeta. */
  readonly seed?: number | undefined;
}

export interface LlmUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
}

export interface LlmResponse {
  readonly text: string;
  readonly model: string;
  readonly usage?: LlmUsage | undefined;
}

export interface LlmClient {
  /** Quién es, para los registros: "ollama:qwen3-14b", "mock". */
  readonly name: string;
  complete(request: LlmRequest): Promise<LlmResponse>;
}

export type LlmErrorKind = "network" | "timeout" | "http" | "format";

export class LlmError extends Error {
  override name = "LlmError";
  readonly kind: LlmErrorKind;
  readonly status?: number | undefined;

  constructor(kind: LlmErrorKind, message: string, status?: number) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export interface OpenAiCompatibleOptions {
  /** Hasta la raíz del servidor, sin `/v1`: "http://localhost:11434". */
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey?: string | undefined;
  readonly timeoutMs?: number | undefined;
  /** Para los tests; por defecto, el `fetch` global. */
  readonly fetch?: Fetch | undefined;
  /** Opciones propias del runtime (gramáticas GBNF, ranura de caché de llama.cpp…). */
  readonly extra?: Readonly<Record<string, unknown>> | undefined;
}

interface ChatCompletion {
  readonly model?: string;
  readonly choices?: readonly { readonly message?: { readonly content?: string | null } }[];
  readonly usage?: { readonly prompt_tokens?: number; readonly completion_tokens?: number };
}

export class OpenAiCompatibleClient implements LlmClient {
  readonly name: string;
  readonly #o: OpenAiCompatibleOptions;

  constructor(name: string, options: OpenAiCompatibleOptions) {
    this.name = name;
    this.#o = options;
  }

  /** El cuerpo del pedido, aparte para poder probarlo sin red. */
  body(request: LlmRequest): Record<string, unknown> {
    const { maxTokens, temperature, seed, schema } = request;
    return {
      ...this.#o.extra,
      model: this.#o.model,
      messages: request.messages,
      stream: false,
      ...(maxTokens === undefined ? {} : { max_tokens: maxTokens }),
      ...(temperature === undefined ? {} : { temperature }),
      ...(seed === undefined ? {} : { seed }),
      ...(schema
        ? {
            response_format: {
              type: "json_schema",
              json_schema: { name: schema.name, schema: schema.schema, strict: true },
            },
          }
        : {}),
    };
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const url = `${this.#o.baseUrl.replace(/\/+$/, "")}/v1/chat/completions`;
    const headers = {
      "content-type": "application/json",
      ...(this.#o.apiKey ? { authorization: `Bearer ${this.#o.apiKey}` } : {}),
    };
    const doFetch = this.#o.fetch ?? fetch;

    let res: Response;
    try {
      res = await doFetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(this.body(request)),
        signal: AbortSignal.timeout(this.#o.timeoutMs ?? 120_000),
      });
    } catch (e) {
      const name = e instanceof Error ? e.name : "";
      if (name === "TimeoutError" || name === "AbortError") {
        throw new LlmError("timeout", `${this.name}: no respondió a tiempo`);
      }
      throw new LlmError("network", `${this.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      throw new LlmError("http", `${this.name}: HTTP ${res.status} ${detail}`.trim(), res.status);
    }
    let data: ChatCompletion;
    try {
      data = (await res.json()) as ChatCompletion;
    } catch {
      throw new LlmError("format", `${this.name}: la respuesta no es JSON`);
    }
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== "string") {
      throw new LlmError("format", `${this.name}: la respuesta no trae choices[0].message.content`);
    }
    const u = data.usage;
    return {
      text,
      model: data.model ?? this.#o.model,
      usage:
        u?.prompt_tokens !== undefined && u.completion_tokens !== undefined
          ? { promptTokens: u.prompt_tokens, completionTokens: u.completion_tokens }
          : undefined,
    };
  }
}

/** Dónde escucha cada runtime local por defecto. */
export const LOCAL_BASE_URLS = {
  ollama: "http://localhost:11434",
  llamacpp: "http://localhost:8080",
  lmstudio: "http://localhost:1234",
} as const;
