import { writeFileSync } from "node:fs";
import { defaultGameSetup, FULL_PROFILE } from "../../game/index.ts";
import type { FullProfileConfig } from "./full-profile.ts";
import { runFullProfileSeed } from "./full-profile-run.ts";

const { seed, config, path } = JSON.parse(process.argv[2] ?? "") as {
  seed: number;
  config: FullProfileConfig;
  path: string;
};
try {
  const report = runFullProfileSeed(seed, config, (message) => {
    const elapsed = `${Math.round(message.elapsedMs)} ms`;
    const memory =
      message.rssBytes === undefined
        ? ""
        : `, RSS ${Math.round(message.rssBytes / 1024 / 1024)} MiB`;
    const detail =
      message.stage === "creation-start"
        ? "creación iniciada"
        : message.stage === "creation-complete"
          ? `creación terminada en ${elapsed}${memory}`
          : `checkpoint ${message.checks}: ${message.worldDays} días, ${message.problems} problemas, ${elapsed}${memory}`;
    process.stdout.write(`full-profile seed ${seed}: ${detail}\n`);
  });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(
    `full-profile seed ${seed}: ${"performance" in report ? `${report.performance.completedYears} años completados, ${report.checks} chequeos` : `fallo en ${report.failure.stage}`}, ${report.stoppedEarly ? "detenida" : "completa"}\n`,
  );
} catch (error) {
  writeFileSync(
    path,
    `${JSON.stringify({ seed, config, setup: { game: defaultGameSetup("realistic"), life: FULL_PROFILE, ...(config.frequency === undefined ? {} : { frequency: config.frequency }) }, reproduction: { seed, replayFrom: "seed", stage: "creation", plans: [] }, stoppedEarly: true, stage: "creation", failure: error instanceof Error ? (error.stack ?? error.message) : String(error) }, null, 2)}\n`,
  );
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
}
