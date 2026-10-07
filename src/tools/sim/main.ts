// `npm run sim -- --seed 123 --years 50 [--frequency N] [--check-days N] [--out sim-reports]`:
// corre una vida sin jugador, deja `sim-reports/sim-<seed>.json` y, si un invariante se viola,
// `repro-<seed>.json` (tooling §6, §9). Sale con código 1 si la corrida se detuvo.

import { randomInt } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { defaultGameSetup, GAME_CONTENT_KINDS } from "../../game/index.ts";
import { loadContentDir } from "../../persistence/index.ts";
import { runSim } from "./sim.ts";

const { values } = parseArgs({
  options: {
    seed: { type: "string" },
    years: { type: "string", default: "1" },
    frequency: { type: "string" },
    "check-days": { type: "string" },
    out: { type: "string", default: "sim-reports" },
  },
});

const seed = values.seed === undefined ? randomInt(0, 0xffffffff) : Number(values.seed);
const years = Number(values.years);
if (!Number.isSafeInteger(seed) || seed < 0) throw new Error(`seed inválido: ${values.seed}`);
if (!(years > 0)) throw new Error(`años inválidos: ${values.years}`);

const report = runSim({
  seed,
  years,
  content: loadContentDir("content", GAME_CONTENT_KINDS),
  setup: {
    game: defaultGameSetup("realistic"),
    ...(values.frequency === undefined ? {} : { frequency: Number(values.frequency) }),
  },
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
  `seed ${seed}: ${years} años, ${m.events} eventos, ${m.agentsAlive} vivos y ${m.agentsDead} muertos, ` +
    `${report.checks} chequeos, ${Math.round(report.performance.wallMs)} ms\n`,
);
if (repro) {
  process.stdout.write(`INVARIANTE VIOLADO en ${repro.tick}:\n${repro.problems.join("\n")}\n`);
  process.exitCode = 1;
}
