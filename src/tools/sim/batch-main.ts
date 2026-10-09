// `npm run sim:batch -- --seeds 1..20 --years 5 [--frequency N] [--check-days N] [--out sim-reports] [--html]`:
// corre la sim headless en varios seeds y deja `batch.json` (resumen por métrica) y, con `--html`,
// `batch.html` (tooling §6). Sale con código 1 si alguna corrida se detuvo por un invariante.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { defaultGameSetup, GAME_CONTENT_KINDS } from "../../game/index.ts";
import { loadContentDir } from "../../persistence/index.ts";
import { parseSeeds, runBatch } from "./batch.ts";
import { diffMetrics } from "./diff.ts";
import { renderDiffHtml } from "./html.ts";

const { values } = parseArgs({
  options: {
    seeds: { type: "string", default: "1..5" },
    years: { type: "string", default: "1" },
    frequency: { type: "string" },
    "check-days": { type: "string" },
    out: { type: "string", default: "sim-reports" },
    html: { type: "boolean", default: false },
  },
});

const years = Number(values.years);
if (!(years > 0)) throw new Error(`años inválidos: ${values.years}`);
const seeds = parseSeeds(values.seeds);

const result = runBatch(seeds, {
  years,
  content: loadContentDir("content", GAME_CONTENT_KINDS),
  setup: {
    game: defaultGameSetup("realistic"),
    ...(values.frequency === undefined ? {} : { frequency: Number(values.frequency) }),
  },
  ...(values["check-days"] === undefined ? {} : { checkEveryDays: Number(values["check-days"]) }),
});

mkdirSync(values.out, { recursive: true });
const body = {
  seeds: result.seeds,
  years,
  stopped: result.stopped,
  summary: result.summary,
};
writeFileSync(join(values.out, "batch.json"), `${JSON.stringify(body, null, 2)}\n`);
if (values.html) {
  // Sin A/B todavía: la página muestra el resumen como diferencia contra cero (media por métrica).
  const rows = diffMetrics(
    {},
    Object.fromEntries(Object.entries(result.summary).map(([k, s]) => [k, s.mean])),
  );
  writeFileSync(join(values.out, "batch.html"), renderDiffHtml(rows, "-", "media"));
}
process.stdout.write(`${seeds.length} seeds, ${years} años; detenidas: ${result.stopped.length}\n`);
if (result.stopped.length > 0) {
  process.stdout.write(`INVARIANTE VIOLADO en seeds: ${result.stopped.join(", ")}\n`);
  process.exitCode = 1;
}
