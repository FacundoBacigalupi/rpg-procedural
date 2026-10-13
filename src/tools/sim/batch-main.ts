// `npm run sim:batch -- --seeds 1..20 --years 5 [--scenario id] [--frequency N] [--check-days N] [--out sim-reports] [--html]`:
// corre la sim headless en varios seeds y deja `batch.json` (resumen por métrica) y, con `--html`,
// `batch.html` (tooling §6). Sale con código 1 si alguna corrida se detuvo por un invariante.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { defaultGameSetup, GAME_CONTENT_KINDS } from "../../game/index.ts";
import { loadContentDir } from "../../persistence/index.ts";
import { parseSeeds, runBatch } from "./batch.ts";
import { diffMetrics } from "./diff.ts";
import { runFullProfileBatch } from "./full-profile-run.ts";
import { renderDiffHtml } from "./html.ts";
import { findScenario, goalMeasurementSetup, scenarioRun } from "./scenario.ts";

const { values } = parseArgs({
  options: {
    seeds: { type: "string", default: "1..5" },
    years: { type: "string" },
    days: { type: "string" },
    "persist-goal-layers": { type: "boolean" },
    "debt-knowledge": { type: "boolean" },
    "goal-report": { type: "boolean" },
    rescue: { type: "boolean" },
    scenario: { type: "string" },
    frequency: { type: "string" },
    "check-days": { type: "string" },
    out: { type: "string", default: "sim-reports" },
    html: { type: "boolean", default: false },
  },
});

if (values.scenario === "full-profile") {
  runFullProfileBatch(
    {
      seeds: parseSeeds(values.seeds),
      years: Number(values.years ?? 1),
      checkEveryDays: Number(values["check-days"] ?? 30),
      ...(values.rescue === true ? { rescue: true } : {}),
      ...(values.days === undefined ? {} : { days: Number(values.days) }),
      ...(values.frequency === undefined ? {} : { frequency: Number(values.frequency) }),
    },
    values.out,
  );
  process.exit(process.exitCode ?? 0);
}

const content = loadContentDir("content", GAME_CONTENT_KINDS);
const frequency = values.frequency === undefined ? undefined : Number(values.frequency);
const scenario =
  values.scenario === undefined
    ? undefined
    : scenarioRun(findScenario(content, values.scenario), frequency);
const years = Number(values.years ?? scenario?.years ?? 1);
if (!(years > 0)) throw new Error(`años inválidos: ${values.years}`);
const seeds = parseSeeds(values.seeds);
const setup = goalMeasurementSetup(
  scenario?.setup ?? {
    game: defaultGameSetup("realistic"),
    ...(frequency === undefined ? {} : { frequency }),
  },
  {
    persistGoalLayers: values["persist-goal-layers"] === true,
    debtKnowledge: values["debt-knowledge"] === true,
  },
);

const result = runBatch(seeds, {
  years,
  ...(values["goal-report"] === true ? { goalReport: true } : {}),
  ...(values.days === undefined ? {} : { days: Number(values.days) }),
  content,
  setup,
  ...(values["check-days"] === undefined ? {} : { checkEveryDays: Number(values["check-days"]) }),
});

mkdirSync(values.out, { recursive: true });
const body = {
  seeds: result.seeds,
  ...(values.days === undefined ? { years } : {}),
  ...(values.days === undefined ? {} : { days: Number(values.days) }),
  ...(values["goal-report"] === true ||
  setup.life?.persistGoalLayers === true ||
  setup.life?.debtKnowledge === true
    ? {
        setup,
        engine: result.reports[0]?.goalMeasurement?.engine,
        content: content.hash,
        goalReport: true,
      }
    : {}),
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
process.stdout.write(
  `${seeds.length} seeds, ${values.days === undefined ? `${years} años` : `${values.days} días`}; detenidas: ${result.stopped.length}\n`,
);
if (result.stopped.length > 0) {
  process.stdout.write(`INVARIANTE VIOLADO en seeds: ${result.stopped.join(", ")}\n`);
  process.exitCode = 1;
}
