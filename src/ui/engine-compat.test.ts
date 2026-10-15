import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../core/index.ts";
import {
  engineOptions,
  LIFE_ENGINE,
  Life,
  type LifeSetup,
  lifeReplayGame,
  optionsOf,
} from "../game/life/life.ts";
import { FULL_PROFILE } from "../game/life/profile.ts";
import { defaultGameSetup } from "../game/setup/index.ts";
import { GAME_CONTENT_KINDS } from "../game/view/index.ts";
import { engineNumber, upgradeVersions } from "../persistence/index.ts";
import { LIFE_ARG_OPTIONS, lifeConfig } from "./config.ts";

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}
const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
const HOURS = 3600;
// El presente de la aldea del seed 7: igual con y sin perfil (la pre-corrida no usa las opciones).
const START = Life.create(7, content, { frequency: 8 }).now;

function setupOf(args: string[]): LifeSetup {
  const values = parseArgs({
    args: ["--seed", "7", "--frequency", "8", ...args],
    options: LIFE_ARG_OPTIONS,
  }).values;
  return lifeConfig(values).setup;
}

function replayHash(setup: LifeSetup, engine: string): unknown {
  const game = lifeReplayGame(content, { engine, content: "none", format: 1 });
  const run = game.start(7, setup);
  run.advanceTo(START + 24 * HOURS);
  return run.hash();
}

describe("motor life-3: perfil completo por defecto en vidas nuevas", () => {
  it("una vida nueva de la CLI/web lleva el perfil completo y --profile basic no", () => {
    expect(setupOf([]).life).toEqual(FULL_PROFILE);
    expect(setupOf(["--profile", "full"]).life).toEqual(FULL_PROFILE);
    expect(setupOf(["--profile", "basic"]).life).toBeUndefined();
    expect(LIFE_ENGINE).toBe("life-26");
  });

  it("una vida guardada sin perfil (life-1/life-2) se rehace igual con el motor nuevo", () => {
    const legacy: LifeSetup = { game: defaultGameSetup("realistic"), frequency: 8 };
    // Las opciones salen solo del setup guardado: el motor nuevo no le suma el perfil.
    expect(optionsOf(legacy)).toEqual({ frequency: 8 });
    const direct = Life.create(7, content, engineOptions("life-2", optionsOf(legacy)));
    direct.advanceTo(START + 24 * HOURS);
    expect(replayHash(legacy, "life-2")).toEqual(direct.hash());
  }, 120_000);

  it("la vida con perfil es determinista y distinta de la vida mínima", () => {
    const profiled = setupOf([]);
    const a = replayHash(profiled, LIFE_ENGINE);
    expect(replayHash(profiled, LIFE_ENGINE)).toEqual(a);
    expect(a).not.toEqual(replayHash(setupOf(["--profile", "basic"]), LIFE_ENGINE));
  }, 240_000);

  it("las vidas de motores anteriores pasan a life-26 con límite de replay; no al revés", () => {
    for (const engine of [
      "life-2",
      "life-3",
      "life-4",
      "life-5",
      "life-6",
      "life-7",
      "life-8",
      "life-9",
      "life-10",
      "life-11",
      "life-12",
      "life-13",
      "life-14",
      "life-15",
      "life-16",
      "life-17",
      "life-18",
      "life-19",
      "life-20",
      "life-21",
      "life-22",
      "life-23",
      "life-24",
      "life-25",
    ]) {
      const saved = { engine, content: "none", format: 1 };
      const current = { ...saved, engine: LIFE_ENGINE };
      expect(upgradeVersions(saved, current, 100)).toMatchObject({
        kind: "upgrade",
        limit: { tick: 100, from: saved, to: current },
      });
    }
    const saved = { engine: "life-3", content: "none", format: 1 };
    const current = { ...saved, engine: LIFE_ENGINE };
    expect(upgradeVersions(current, saved, 100).kind).toBe("incompatible");
    expect(engineNumber(LIFE_ENGINE)).toBe(26);
  });
});
