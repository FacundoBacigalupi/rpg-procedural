// `node src/tools/sim/speak-acts-main.ts --seeds 1..2 --days 30 [--frequency 8] [--out sim-reports]`:
// mide `speakActs` por variante de silencio y deja `sim-reports/speak-acts.json` (npc-c5c).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { EARTHLIKE_CLOCK } from "../../core/index.ts";
import { GAME_CONTENT_KINDS } from "../../game/index.ts";
import { loadContentDir } from "../../persistence/index.ts";
import { parseSeeds } from "./batch.ts";
import { measureSpeakActs, speakActsVariants } from "./speak-acts.ts";

const { values } = parseArgs({
  options: {
    seeds: { type: "string", default: "1..2" },
    days: { type: "string", default: "30" },
    frequency: { type: "string", default: "8" },
    out: { type: "string", default: "sim-reports" },
  },
});
const content = loadContentDir("content", GAME_CONTENT_KINDS);
const days = Number(values.days);
const rows = parseSeeds(values.seeds ?? "1..2").flatMap((seed) =>
  speakActsVariants(EARTHLIKE_CLOCK.day).map((v) => ({
    seed,
    ...measureSpeakActs(seed, content, days, v, Number(values.frequency)),
  })),
);
mkdirSync(values.out ?? "sim-reports", { recursive: true });
writeFileSync(
  join(values.out ?? "sim-reports", "speak-acts.json"),
  `${JSON.stringify(rows, null, 2)}\n`,
);
for (const r of rows) {
  process.stdout.write(
    `seed ${r.seed} ${r.variant}: ${r.speaks} hablas (${r.speaksPerNpcDay}/NPC-día), ${r.problems} problemas\n`,
  );
}
