// `node src/tools/sim/layer-pull-main.ts --seeds 1..3 --years 0.25 [--frequency N] [--out sim-reports]`:
// compara la vida con y sin capas persistidas (f3e) y deja `sim-reports/layer-pull.json`.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { GAME_CONTENT_KINDS } from "../../game/index.ts";
import { loadContentDir } from "../../persistence/index.ts";
import { parseSeeds } from "./batch.ts";
import { measureLayers } from "./layer-pull.ts";

const { values } = parseArgs({
  options: {
    seeds: { type: "string", default: "1..3" },
    years: { type: "string", default: "0.25" },
    frequency: { type: "string" },
    out: { type: "string", default: "sim-reports" },
  },
});
const content = loadContentDir("content", GAME_CONTENT_KINDS);
const result = measureLayers(
  parseSeeds(values.seeds ?? "1..3"),
  content,
  Number(values.years),
  values.frequency === undefined ? undefined : Number(values.frequency),
);
mkdirSync(values.out ?? "sim-reports", { recursive: true });
writeFileSync(
  join(values.out ?? "sim-reports", "layer-pull.json"),
  `${JSON.stringify(result, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify(result.summary, null, 2)}\n`);
