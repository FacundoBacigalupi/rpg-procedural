// `node src/tools/sim/speak-acts-main.ts --seeds 1..2 --days 30 [--frequency 8] [--out sim-reports]`:
// mide `speakActs` por variante de silencio y deja `sim-reports/speak-acts.json` (npc-c5c).
// Una `Life` pesa ~1 GB de heap (~2,4 GB de rss) y el proceso no devuelve esa memoria al sistema
// (medido: tras soltar la vida el heap vuelve a ~25 MB, el rss se queda en ~2,3 GB), así que cada
// seed x variante corre en su propio proceso (`--seed N --variant nombre`); el padre junta las filas.

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { EARTHLIKE_CLOCK } from "../../core/index.ts";
import { GAME_CONTENT_KINDS } from "../../game/index.ts";
import { loadContentDir } from "../../persistence/index.ts";
import { parseSeeds } from "./batch.ts";
import { measureSpeakActs, type SpeakActsRun, speakActsVariants } from "./speak-acts.ts";

const { values } = parseArgs({
  options: {
    seeds: { type: "string", default: "1..2" },
    days: { type: "string", default: "30" },
    frequency: { type: "string", default: "8" },
    out: { type: "string", default: "sim-reports" },
    // Uso interno: un solo seed y una sola variante, y una fila JSON por la salida estándar.
    seed: { type: "string" },
    variant: { type: "string" },
  },
});
const days = Number(values.days);
const frequency = Number(values.frequency);
const variants = speakActsVariants(EARTHLIKE_CLOCK.day);

if (values.seed !== undefined && values.variant !== undefined) {
  const variant = variants.find((v) => v.name === values.variant);
  if (!variant) throw new Error(`variante desconocida: ${values.variant}`);
  const content = loadContentDir("content", GAME_CONTENT_KINDS);
  const seed = Number(values.seed);
  const row = { seed, ...measureSpeakActs(seed, content, days, variant, frequency) };
  process.stdout.write(`ROW ${JSON.stringify(row)}\n`);
} else {
  const rows: (SpeakActsRun & { seed: number })[] = [];
  for (const seed of parseSeeds(values.seeds ?? "1..2")) {
    for (const v of variants) {
      const child = spawnSync(
        process.execPath,
        [
          process.argv[1] as string,
          "--seed",
          String(seed),
          "--variant",
          v.name,
          "--days",
          String(days),
          "--frequency",
          String(frequency),
        ],
        { encoding: "utf8", maxBuffer: 1 << 24 },
      );
      const line = child.stdout.split("\n").find((l) => l.startsWith("ROW "));
      if (child.status !== 0 || !line) {
        throw new Error(
          `seed ${seed} ${v.name}: terminó con ${child.status ?? child.signal}\n${child.stderr}`,
        );
      }
      rows.push(JSON.parse(line.slice(4)));
    }
  }
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
}
