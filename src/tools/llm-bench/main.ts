// `npm run llm-bench -- --models qwen3:14b,gemma3:12b [--swap qwen3:4b] [--runtime ollama]
// [--base-url URL] [--repeat N] [--all] [--free] [--record test/fixtures/parser] [--out DIR]`:
// corre los ejemplos del parser contra cada modelo local y deja una tabla y un reporte JSON en
// `sim-reports/llm-bench/`. Con `--swap`, mide el turno alternando narrar con el primer modelo y
// parsear con el chico (narration §1). Con `--record`, graba las respuestas como fixtures para
// repetir el banco sin red. Con `--free`, corre también sin salida restringida.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  type LlmClient,
  LOCAL_BASE_URLS,
  OpenAiCompatibleClient,
  parserSetup,
} from "../../llm/index.ts";
import { loadContentDir } from "../../persistence/index.ts";
import { ACTIONS, ActionCatalog, CONTENT_KINDS, PARSER_EXAMPLES, PLANS } from "../../sim/index.ts";
import {
  benchCases,
  benchModel,
  benchSwap,
  fixtureOf,
  formatSummaries,
  type ModelSummary,
} from "./bench.ts";

const { values } = parseArgs({
  options: {
    models: { type: "string" },
    swap: { type: "string" },
    runtime: { type: "string", default: "ollama" },
    "base-url": { type: "string" },
    repeat: { type: "string", default: "1" },
    all: { type: "boolean", default: false },
    free: { type: "boolean", default: false },
    record: { type: "string" },
    out: { type: "string", default: "sim-reports/llm-bench" },
    timeout: { type: "string", default: "120000" },
  },
});

const runtime = values.runtime as keyof typeof LOCAL_BASE_URLS;
if (!(runtime in LOCAL_BASE_URLS)) throw new Error(`runtime desconocido: ${values.runtime}`);
const baseUrl = values["base-url"] ?? LOCAL_BASE_URLS[runtime];
const models = (values.models ?? "").split(",").filter((m) => m.length > 0);
if (models.length === 0) throw new Error("falta --models (por ejemplo: --models qwen3:14b)");
const timeoutMs = Number(values.timeout);

const content = loadContentDir("content", CONTENT_KINDS);
const catalog = new ActionCatalog(content.all(ACTIONS), content.all(PLANS));
const examples = content.all(PARSER_EXAMPLES);
const setup = parserSetup(catalog, examples);
const cases = benchCases(examples, values.all);
const now = () => performance.now();

const client = (model: string): LlmClient =>
  new OpenAiCompatibleClient(model, { baseUrl, model, timeoutMs });

/** Ollama: saca un modelo de la memoria, para que el arranque en frío se mida de verdad. */
async function unload(model: string): Promise<void> {
  if (runtime !== "ollama") return;
  await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    body: JSON.stringify({ model, keep_alive: 0 }),
  }).catch(() => undefined);
}

console.log(`${cases.length} casos, ${setup.shots.length / 2} ejemplos en el prompt, ${baseUrl}`);
const summaries: ModelSummary[] = [];
const results: Record<string, unknown> = {};
const report: {
  contentHash: string;
  baseUrl: string;
  models: Record<string, unknown>;
  swap?: unknown;
} = {
  contentHash: content.hash,
  baseUrl,
  models: results,
};
for (const model of models) {
  for (const grammar of values.free ? [true, false] : [true]) {
    await unload(model);
    console.log(`→ ${model}${grammar ? "" : " (sin restringir)"}`);
    const r = await benchModel({
      client: client(model),
      setup,
      examples: cases,
      now,
      repeat: Number(values.repeat),
      grammar,
    });
    summaries.push(r.summary);
    if (r.results.every((c) => c.problems.some((p) => p.endsWith("fetch failed")))) {
      console.warn(`  sin respuesta de ${baseUrl}: ¿está corriendo ${runtime}?`);
    }
    results[r.summary.model] = r;
    if (values.record && grammar) {
      mkdirSync(values.record, { recursive: true });
      const file = join(values.record, `${model.replace(/[^\w.-]+/g, "_")}.json`);
      writeFileSync(
        file,
        `${JSON.stringify(fixtureOf(model, content.hash, r.results), null, 2)}\n`,
      );
    }
  }
}
console.log(`\n${formatSummaries(summaries)}`);

const resident = models[0];
if (values.swap && resident) {
  console.log(`\n→ cambio de modelo: narra ${resident}, parsea ${values.swap}`);
  const swap = await benchSwap({
    resident: client(resident),
    parser: client(values.swap),
    setup,
    examples: cases,
    now,
  });
  report.swap = swap;
  console.log(
    `parsear con ${resident}: ${(swap.sameMs / 1000).toFixed(2)} s (${swap.samePass}/${swap.cases} bien)\n` +
      `parsear con ${values.swap}: ${(swap.swapMs / 1000).toFixed(2)} s (${swap.swapPass}/${swap.cases} bien)\n` +
      `costo del cambio por turno: ${(swap.penaltyMs / 1000).toFixed(2)} s`,
  );
}

mkdirSync(values.out, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const file = join(values.out, `bench-${stamp}.json`);
writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
console.log(`\nreporte: ${file}`);
