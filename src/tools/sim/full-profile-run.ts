// Una Life por proceso: al terminar el worker, el SO libera también el heap retenido.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertLifeDependencies,
  defaultGameSetup,
  FULL_PROFILE,
  GAME_CONTENT_KINDS,
  LIFE_ENGINE,
  Life,
  optionsOf,
} from "../../game/index.ts";
import { loadContentDir } from "../../persistence/index.ts";
import { checkInvariants, DEMOGRAPHY } from "../../sim/index.ts";
import {
  type FullProfileConfig,
  type FullProfileProgress,
  type ProcessMeasurement,
  profileCoverage,
  profileDemography,
  recordProcess,
  validateFullProfileConfig,
} from "./full-profile.ts";

export function runFullProfileSeed(
  seed: number,
  config: FullProfileConfig,
  progress?: (message: FullProfileProgress) => void,
) {
  validateFullProfileConfig(config);
  if (!Number.isSafeInteger(seed) || seed < 0)
    throw new RangeError("seed debe ser entero no negativo");
  let stage = "creation";
  try {
    return measureFullProfileSeed(seed, config, progress, (next) => {
      stage = next;
    });
  } catch (error) {
    const setup = {
      game: defaultGameSetup("realistic"),
      life: FULL_PROFILE,
      ...(config.frequency === undefined ? {} : { frequency: config.frequency }),
    };
    return {
      scenario: "full-profile",
      seed,
      config,
      setup,
      stoppedEarly: true,
      failure: {
        stage,
        message: error instanceof Error ? (error.stack ?? error.message) : String(error),
      },
      reproduction: { seed, setup, replayFrom: "seed", stage, plans: [] },
    };
  }
}

function measureFullProfileSeed(
  seed: number,
  config: FullProfileConfig,
  progress?: (message: FullProfileProgress) => void,
  setStage?: (stage: string) => void,
) {
  validateFullProfileConfig(config);
  const content = loadContentDir("content", GAME_CONTENT_KINDS);
  const setup = {
    game: defaultGameSetup("realistic"),
    life: FULL_PROFILE,
    ...(config.frequency === undefined ? {} : { frequency: config.frequency }),
  };
  const processes = new Map<string, ProcessMeasurement>();
  assertLifeDependencies(optionsOf(setup));
  const started = performance.now();
  progress?.({ seed, stage: "creation-start", elapsedMs: 0 });
  const life = Life.create(seed, content, {
    ...optionsOf(setup),
    runProbe: (id, changes, events) => recordProcess(processes, id, changes, events),
  });
  const creationMs = performance.now() - started;
  progress?.({
    seed,
    stage: "creation-complete",
    elapsedMs: creationMs,
    tick: life.now,
    rssBytes: process.memoryUsage().rss,
  });
  const creationProcesses = Object.fromEntries(processes);
  processes.clear();
  const from = life.now;
  const world = life.world;
  const demography = content.get(DEMOGRAPHY, "human.preindustrial-village");
  if (!demography) throw new Error("sin demografía human.preindustrial-village");
  const coverageInitial = profileCoverage(world.truth, from, world.clock, demography.fertility);
  setStage?.("duration");
  const duration =
    config.days === undefined ? config.years * world.clock.year : config.days * world.clock.day;
  const target = from + Math.round(duration);
  const step = config.checkEveryDays * world.clock.day;
  if (!Number.isSafeInteger(target) || target <= from || !Number.isSafeInteger(step))
    throw new RangeError("duración o cadencia fuera del rango de ticks");
  let checks = 0;
  setStage?.("initial-invariants");
  let problems = checkInvariants({ truth: world.truth, log: world.log, ledger: world.ledger });
  checks++;
  const samples = [{ tick: life.now, elapsedMs: creationMs, memory: process.memoryUsage() }];
  progress?.({
    seed,
    stage: "checkpoint",
    elapsedMs: performance.now() - started,
    tick: life.now,
    worldDays: 0,
    checks,
    problems: problems.length,
    rssBytes: process.memoryUsage().rss,
  });
  let stage = "advance";
  let failure: string | undefined;
  const simulationStarted = performance.now();
  let completeThrough = from;
  let completedSimulationMs = 0;
  try {
    while (life.now < target && problems.length === 0) {
      setStage?.("advance");
      life.advanceTo(Math.min(target, life.now + step));
      stage = "invariants";
      setStage?.(stage);
      problems = checkInvariants({ truth: world.truth, log: world.log, ledger: world.ledger });
      checks++;
      if (problems.length === 0) {
        completeThrough = life.now;
        completedSimulationMs = performance.now() - simulationStarted;
      }
      samples.push({
        tick: life.now,
        elapsedMs: performance.now() - started,
        memory: process.memoryUsage(),
      });
      progress?.({
        seed,
        stage: "checkpoint",
        elapsedMs: performance.now() - started,
        tick: life.now,
        worldDays: (life.now - from) / world.clock.day,
        checks,
        problems: problems.length,
        rssBytes: process.memoryUsage().rss,
      });
      stage = "advance";
    }
  } catch (error) {
    failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
  }
  const simulationMs = performance.now() - simulationStarted;
  const completedYears = (completeThrough - from) / world.clock.year;
  setStage?.("report");
  return {
    scenario: "full-profile",
    seed,
    versions: { engine: LIFE_ENGINE, content: content.hash, format: 1 },
    setup,
    config,
    from,
    to: life.now,
    completeThrough,
    target,
    checks,
    stoppedEarly: problems.length > 0 || failure !== undefined,
    problems,
    ...(failure === undefined ? {} : { failure: { stage, message: failure } }),
    metrics: profileDemography(world.log.all(), from),
    coverage: {
      initial: coverageInitial,
      final: profileCoverage(world.truth, life.now, world.clock, demography.fertility),
    },
    performance: {
      creationMs,
      simulationMs,
      completedSimulationMs,
      completedYears,
      observedYears: (life.now - from) / world.clock.year,
      msPerWorldYear: completedYears > 0 ? completedSimulationMs / completedYears : null,
      peakSampledRssBytes: samples.reduce((peak, s) => Math.max(peak, s.memory.rss), 0),
      maxRssBytes: process.resourceUsage().maxRSS * 1024,
      creationProcesses,
      processes: Object.fromEntries([...processes].sort(([a], [b]) => a.localeCompare(b))),
      samples,
    },
    // Todo fallo conserva seed + setup exacto; no atribuye a una opción sin aislarla.
    ...(problems.length > 0 || failure !== undefined
      ? {
          reproduction: {
            seed,
            setup,
            observedTick: life.now,
            completeThrough,
            replayFrom: "seed",
            stage: failure === undefined ? "invariants" : stage,
            plans: [],
          },
        }
      : {}),
  };
}

export function runFullProfileBatch(config: FullProfileConfig, out: string): void {
  validateFullProfileConfig(config);
  mkdirSync(out, { recursive: true });
  const runs = [];
  for (const seed of config.seeds) {
    const path = join(out, `full-profile-${seed}.json`);
    // Un worker interrumpido no debe heredar el reporte de una ejecución anterior.
    if (existsSync(path)) unlinkSync(path);
    const child = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("./full-profile-worker.ts", import.meta.url)),
        JSON.stringify({ seed, config, path }),
      ],
      { stdio: "inherit" },
    );
    if (child.error || child.status !== 0) {
      runs.push({
        seed,
        stoppedEarly: true,
        ...(existsSync(path) ? { report: path } : {}),
        failure: child.error?.message ?? `worker exit ${child.status}, signal ${child.signal}`,
      });
      process.exitCode = 1;
    } else {
      const report = JSON.parse(readFileSync(path, "utf8")) as ReturnType<
        typeof runFullProfileSeed
      >;
      runs.push({ seed, stoppedEarly: report.stoppedEarly, report: path });
      if (report.stoppedEarly) process.exitCode = 1;
    }
  }
  writeFileSync(
    join(out, "full-profile-batch.json"),
    `${JSON.stringify({ scenario: "full-profile", config, runs }, null, 2)}\n`,
  );
}
