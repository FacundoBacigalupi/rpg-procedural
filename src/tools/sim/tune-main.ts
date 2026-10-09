// `npm run sim:tune -- [--only id1,id2] [--frequency N] [--check-days N] [--out sim-reports]`:
// corre la suite de calibración (`content/tuning/`, tooling §7), imprime cada objetivo y deja
// `tuning.json`. Es lenta; sale con código 1 si algún objetivo no se cumple.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { GAME_CONTENT_KINDS } from "../../game/index.ts";
import { loadContentDir } from "../../persistence/index.ts";
import { formatTuning, runTuning } from "./tuning.ts";

const { values } = parseArgs({
  options: {
    only: { type: "string" },
    frequency: { type: "string" },
    "check-days": { type: "string" },
    out: { type: "string", default: "sim-reports" },
  },
});

const report = runTuning(
  loadContentDir("content", GAME_CONTENT_KINDS),
  {
    ...(values.frequency === undefined ? {} : { frequency: Number(values.frequency) }),
    ...(values["check-days"] === undefined ? {} : { checkEveryDays: Number(values["check-days"]) }),
  },
  values.only?.split(",").map((s) => s.trim()),
);

mkdirSync(values.out, { recursive: true });
writeFileSync(join(values.out, "tuning.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${formatTuning(report)}\n`);
if (!report.ok) process.exitCode = 1;
