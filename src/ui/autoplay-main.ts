// `node src/ui/autoplay-main.ts --seed 1 --years 2 [--check-days 30] [--out sim-reports/autoplay]
// [--profile full|basic] [--keep-save]`: una partida con el personaje activo (ROADMAP perfil5), sin LLM,
// en un solo proceso (una Life pesa ~1-2 GB y no se devuelve al sistema: una seed por corrida).
// Deja `autoplay-<seed>.json` en `--out`. Una sola corrida pesada a la vez.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { GAME_CONTENT_KINDS } from "../game/index.ts";
import { LifeStore, loadContentDir, openSqlite } from "../persistence/index.ts";
import { runAutoplay } from "./autoplay.ts";
import { lifeConfig } from "./config.ts";
import { openSession } from "./session.ts";

const { values } = parseArgs({
  options: {
    seed: { type: "string", default: "1" },
    years: { type: "string", default: "1" },
    "check-days": { type: "string", default: "30" },
    out: { type: "string", default: "sim-reports/autoplay" },
    profile: { type: "string" },
    "keep-save": { type: "boolean", default: false },
  },
});
const seed = Number(values.seed);
mkdirSync(values.out as string, { recursive: true });
const save = join(values.out as string, `autoplay-${seed}.sqlite`);
rmSync(save, { force: true });
const config = lifeConfig({
  seed: String(seed),
  mode: "realista",
  save,
  runtime: "ollama",
  think: false,
  ...(values.profile ? { profile: values.profile } : {}),
});
const db = openSqlite(save);
try {
  const t0 = performance.now();
  const session = await openSession(LifeStore.open(db), {
    seed: config.seed,
    setup: config.setup,
    content: loadContentDir("content", GAME_CONTENT_KINDS),
  });
  const createMs = Math.round(performance.now() - t0);
  process.stdout.write(`seed ${seed}: sesion abierta en ${createMs} ms\n`);
  const report = await runAutoplay(
    session,
    { seed, years: Number(values.years), checkEveryDays: Number(values["check-days"]) },
    (line) => process.stdout.write(`${line}\n`),
  );
  const out = join(values.out as string, `autoplay-${seed}.json`);
  writeFileSync(
    out,
    `${JSON.stringify({ createMs, profile: values.profile ?? "full", ...report }, null, 2)}\n`,
  );
  process.stdout.write(
    `seed ${seed}: ${report.completedYears} anios, ${report.turns} turnos, ${report.problems.length} problemas, personaje ${report.playerAlive ? "vivo" : "muerto"}, ${report.wallSeconds} s -> ${out}\n`,
  );
  if (report.problems.length > 0 || report.failure) process.exitCode = 1;
} finally {
  db.close();
  if (!values["keep-save"]) rmSync(save, { force: true });
}
