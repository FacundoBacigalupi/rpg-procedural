// `npm run sim -- --seed 123 --years 50 [--scenario id] [--frequency N] [--check-days N] [--out sim-reports]`:
// corre una vida sin jugador, deja `sim-reports/sim-<seed>.json` y, si un invariante se viola,
// `repro-<seed>.json` (tooling §6, §9). Sale con código 1 si la corrida se detuvo.

import { randomInt } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { defaultGameSetup, GAME_CONTENT_KINDS } from "../../game/index.ts";
import { loadContentDir } from "../../persistence/index.ts";
import { findScenario, goalMeasurementSetup, scenarioRun } from "./scenario.ts";
import { runSim } from "./sim.ts";

const { values } = parseArgs({
  options: {
    seed: { type: "string" },
    years: { type: "string" },
    days: { type: "string" },
    "persist-goal-layers": { type: "boolean" },
    "debt-knowledge": { type: "boolean" },
    "goal-report": { type: "boolean" },
    scenario: { type: "string" },
    frequency: { type: "string" },
    "check-days": { type: "string" },
    out: { type: "string", default: "sim-reports" },
  },
});

const seed = values.seed === undefined ? randomInt(0, 0xffffffff) : Number(values.seed);
const content = loadContentDir("content", GAME_CONTENT_KINDS);
const frequency = values.frequency === undefined ? undefined : Number(values.frequency);
const scenario =
  values.scenario === undefined
    ? undefined
    : scenarioRun(findScenario(content, values.scenario), frequency);
const years = Number(values.years ?? scenario?.years ?? 1);
if (!Number.isSafeInteger(seed) || seed < 0) throw new Error(`seed inválido: ${values.seed}`);
if (!(years > 0)) throw new Error(`años inválidos: ${values.years}`);

const report = runSim({
  seed,
  years,
  ...(values["goal-report"] === true ? { goalReport: true } : {}),
  ...(values.days === undefined ? {} : { days: Number(values.days) }),
  content,
  setup: goalMeasurementSetup(
    scenario?.setup ?? {
      game: defaultGameSetup("realistic"),
      ...(frequency === undefined ? {} : { frequency }),
    },
    { persistGoalLayers: values["persist-goal-layers"], debtKnowledge: values["debt-knowledge"] },
  ),
  ...(values["check-days"] === undefined ? {} : { checkEveryDays: Number(values["check-days"]) }),
});

mkdirSync(values.out, { recursive: true });
const { repro, ...rest } = report;
writeFileSync(join(values.out, `sim-${seed}.json`), `${JSON.stringify(rest, null, 2)}\n`);
if (repro) {
  writeFileSync(join(values.out, `repro-${seed}.json`), `${JSON.stringify(repro, null, 2)}\n`);
}
const m = report.metrics;
process.stdout.write(
  `seed ${seed}: ${report.years} años, ${m.events} eventos, ${m.agentsAlive} vivos y ${m.agentsDead} muertos, ` +
    `${report.checks} chequeos, ${Math.round(report.performance.wallMs)} ms\n`,
);
if (repro) {
  process.stdout.write(`INVARIANTE VIOLADO en ${repro.tick}:\n${repro.problems.join("\n")}\n`);
  process.exitCode = 1;
}
