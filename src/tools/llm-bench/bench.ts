// El banco de pruebas de modelos locales para el parser (narration §1, §10): los ejemplos de
// `content/llm/parser-examples/` contra cada modelo, con la misma cadena de trabajos del juego
// (regenerar una vez con el error explicado). Mide si el borrador valida, si se parece al esperado
// (`score.ts`), cuántos salen al primer intento, la latencia y, con un segundo modelo, cuánto cuesta
// cambiar de modelo en cada turno: el residente narra y otro más chico parsea (narration §1: en
// 12 GB no entran dos modelos a la vez, y si el cambio es caro, el parser aparte no vale).
//
// No sabe de red ni de reloj: recibe los clientes y `now`. `main.ts` los arma con el `fetch` real.

import {
  type JobLogEntry,
  LLM_JOBS,
  type LlmClient,
  LlmConfig,
  LlmJobs,
  type LlmRequest,
  type LlmResponse,
  type ParserSetup,
  parseIntent,
} from "../../llm/index.ts";
import type { ParserExample } from "../../sim/index.ts";
import { type DraftScore, SCORE_FIELDS, type ScoreField, scoreDraft } from "./score.ts";

/** Un cliente que guarda el texto crudo de cada respuesta, para grabar fixtures. */
export class RecordingClient implements LlmClient {
  readonly name: string;
  readonly texts: string[] = [];
  readonly #inner: LlmClient;

  constructor(inner: LlmClient) {
    this.#inner = inner;
    this.name = inner.name;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const res = await this.#inner.complete(request);
    this.texts.push(res.text);
    return res;
  }
}

/** Los trabajos con un solo proveedor y plantillas detrás, como en el juego. */
export function singleClientJobs(
  client: LlmClient,
  log?: (e: JobLogEntry) => void,
  grammar = true,
): LlmJobs {
  const local = { kind: "local", runtime: "ollama", model: client.name, grammar };
  const chain = [local, { kind: "templates" }];
  const config = LlmConfig.parse({
    jobs: Object.fromEntries(LLM_JOBS.map((j) => [j, chain])),
    promptLanguage: "en",
    outputLanguage: "es",
  });
  return new LlmJobs({ config, clientFor: (p) => (p.kind === "local" ? client : undefined), log });
}

export interface CaseResult {
  readonly id: string;
  readonly ok: boolean;
  readonly attempts: number;
  readonly ms: number;
  readonly score?: DraftScore | undefined;
  readonly problems: readonly string[];
  /** Lo que contestó el modelo en cada intento, tal cual. */
  readonly raw: readonly string[];
  readonly promptTokens?: number | undefined;
  readonly completionTokens?: number | undefined;
}

export interface ModelSummary {
  readonly model: string;
  readonly cases: number;
  /** Salió un borrador válido (con regenerar incluido). */
  readonly valid: number;
  readonly firstTry: number;
  readonly pass: number;
  readonly fields: Readonly<Record<ScoreField, number>>;
  /** El primer pedido, que incluye cargar el modelo si no estaba. */
  readonly coldMs: number;
  readonly msMean: number;
  readonly msP50: number;
  readonly msP95: number;
  readonly completionTokensPerSecond?: number | undefined;
}

export interface BenchOptions {
  readonly client: LlmClient;
  readonly setup: ParserSetup;
  readonly examples: readonly ParserExample[];
  readonly now: () => number;
  /** Cuántas veces se corre cada ejemplo (la temperatura es 0; sirve para la latencia). */
  readonly repeat?: number | undefined;
  /** Sin salida restringida, para ver cuánto aporta el JSON Schema. */
  readonly grammar?: boolean | undefined;
  /** Se llama después de cada caso, para ver el avance. */
  readonly onCase?: ((r: CaseResult) => void) | undefined;
}

/** Los casos que se puntúan: los ejemplos que no van en el prompt. */
export function benchCases(examples: readonly ParserExample[], all = false): ParserExample[] {
  return examples.filter((e) => all || !e.shot);
}

async function runCase(
  client: RecordingClient,
  setup: ParserSetup,
  e: ParserExample,
  now: () => number,
  grammar = true,
): Promise<CaseResult> {
  const log: JobLogEntry[] = [];
  const jobs = singleClientJobs(client, (entry) => log.push(entry), grammar);
  const from = client.texts.length;
  const t0 = now();
  const r = await parseIntent(jobs, setup, e);
  const ms = now() - t0;
  const sum = (k: "promptTokens" | "completionTokens") =>
    log.some((l) => l[k] !== undefined) ? log.reduce((s, l) => s + (l[k] ?? 0), 0) : undefined;
  return {
    id: e.id,
    ok: r.ok,
    attempts: r.ok ? r.attempts : log.length,
    ms,
    score: r.ok ? scoreDraft(e.expect, r.value) : undefined,
    problems: r.ok ? [] : r.problems,
    raw: client.texts.slice(from),
    promptTokens: sum("promptTokens"),
    completionTokens: sum("completionTokens"),
  };
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[i] as number;
}

export function summarize(
  model: string,
  results: readonly CaseResult[],
  coldMs: number,
): ModelSummary {
  const ms = results.map((r) => r.ms).sort((a, b) => a - b);
  const fields = Object.fromEntries(
    SCORE_FIELDS.map((f) => [f, results.filter((r) => r.score?.[f]).length]),
  ) as Record<ScoreField, number>;
  const tokens = results.reduce((s, r) => s + (r.completionTokens ?? 0), 0);
  const seconds = results.reduce((s, r) => s + r.ms, 0) / 1000;
  return {
    model,
    cases: results.length,
    valid: results.filter((r) => r.ok).length,
    firstTry: results.filter((r) => r.ok && r.attempts === 1).length,
    pass: results.filter((r) => r.score?.pass).length,
    fields,
    coldMs,
    msMean: ms.length > 0 ? ms.reduce((a, b) => a + b, 0) / ms.length : 0,
    msP50: quantile(ms, 0.5),
    msP95: quantile(ms, 0.95),
    completionTokensPerSecond: tokens > 0 && seconds > 0 ? tokens / seconds : undefined,
  };
}

/** Corre los ejemplos contra un modelo. El primer pedido se mide aparte como arranque en frío. */
export async function benchModel(
  o: BenchOptions,
): Promise<{ results: CaseResult[]; summary: ModelSummary }> {
  const client = new RecordingClient(o.client);
  const [first] = o.examples;
  let coldMs = 0;
  if (first) coldMs = (await runCase(client, o.setup, first, o.now, o.grammar)).ms;
  const results: CaseResult[] = [];
  for (let k = 0; k < (o.repeat ?? 1); k++) {
    for (const e of o.examples) {
      const r = await runCase(client, o.setup, e, o.now, o.grammar);
      results.push(r);
      o.onCase?.(r);
    }
  }
  const name = o.grammar === false ? `${o.client.name} (free)` : o.client.name;
  return { results, summary: summarize(name, results, coldMs) };
}

/** Un pedido de narración típico, para ocupar al modelo residente entre parseos. */
export const NARRATION_PROBE: LlmRequest = {
  messages: [
    { role: "system", content: "You narrate a scene in Spanish, second person, present tense." },
    { role: "user", content: "Describí en dos oraciones la plaza de una aldea al mediodía." },
  ],
  maxTokens: 120,
  temperature: 0,
};

export interface SwapSummary {
  readonly resident: string;
  readonly parser: string;
  /** Parsear con el residente después de narrar con él. */
  readonly sameMs: number;
  /** Parsear con el modelo aparte después de narrar con el residente. */
  readonly swapMs: number;
  /** Lo que se agrega por turno al usar el parser aparte. */
  readonly penaltyMs: number;
  readonly samePass: number;
  readonly swapPass: number;
  readonly cases: number;
}

/**
 * El turno real alterna narrar y parsear. Se mide parsear después de narrar con el mismo modelo y
 * con uno aparte; la diferencia es lo que cuesta el cambio (cargar, descargar, perder la caché).
 */
export async function benchSwap(o: {
  readonly resident: LlmClient;
  readonly parser: LlmClient;
  readonly setup: ParserSetup;
  readonly examples: readonly ParserExample[];
  readonly now: () => number;
}): Promise<SwapSummary> {
  const run = async (parser: LlmClient) => {
    const rec = new RecordingClient(parser);
    const out: CaseResult[] = [];
    for (const e of o.examples) {
      await o.resident.complete(NARRATION_PROBE);
      out.push(await runCase(rec, o.setup, e, o.now));
    }
    return out;
  };
  const same = await run(o.resident);
  const swap = await run(o.parser);
  const mean = (rs: readonly CaseResult[]) =>
    rs.length > 0 ? rs.reduce((s, r) => s + r.ms, 0) / rs.length : 0;
  return {
    resident: o.resident.name,
    parser: o.parser.name,
    sameMs: mean(same),
    swapMs: mean(swap),
    penaltyMs: mean(swap) - mean(same),
    samePass: same.filter((r) => r.score?.pass).length,
    swapPass: swap.filter((r) => r.score?.pass).length,
    cases: o.examples.length,
  };
}

/** Las respuestas grabadas de un modelo, para repetir el banco sin red (narration, Tests). */
export interface ParserFixture {
  readonly model: string;
  /** La versión del contenido con la que se grabó (tooling §4). */
  readonly contentHash: string;
  readonly cases: readonly {
    readonly id: string;
    readonly raw: readonly string[];
    readonly ok: boolean;
    readonly pass: boolean;
  }[];
}

export function fixtureOf(
  model: string,
  contentHash: string,
  results: readonly CaseResult[],
): ParserFixture {
  return {
    model,
    contentHash,
    cases: results.map((r) => ({ id: r.id, raw: r.raw, ok: r.ok, pass: r.score?.pass ?? false })),
  };
}

/** Una tabla de texto para la consola. */
export function formatSummaries(summaries: readonly ModelSummary[]): string {
  const pct = (n: number, d: number) => (d === 0 ? "-" : `${Math.round((100 * n) / d)}%`);
  const head = [
    "model",
    "valid",
    "1st",
    "pass",
    ...SCORE_FIELDS,
    "cold s",
    "mean s",
    "p95 s",
    "tok/s",
  ];
  const rows = summaries.map((s) => [
    s.model,
    pct(s.valid, s.cases),
    pct(s.firstTry, s.cases),
    pct(s.pass, s.cases),
    ...SCORE_FIELDS.map((f) => pct(s.fields[f], s.cases)),
    (s.coldMs / 1000).toFixed(1),
    (s.msMean / 1000).toFixed(2),
    (s.msP95 / 1000).toFixed(2),
    s.completionTokensPerSecond === undefined ? "-" : s.completionTokensPerSecond.toFixed(0),
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: readonly string[]) =>
    cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join("  ");
  return [line(head), ...rows.map(line)].join("\n");
}
