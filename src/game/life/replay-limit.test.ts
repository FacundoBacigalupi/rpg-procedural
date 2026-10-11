import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import { LifeStore, openSqlite } from "../../persistence/index.ts";
import { replay, replayInputFromStore } from "../../tools/replay/index.ts";
import { defaultGameSetup } from "../setup/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life, type LifeSetup, lifeReplayGame, optionsOf } from "./life.ts";

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

describe("replay desde el límite de motor (vida real)", () => {
  it("retomar el snapshot del límite con el motor nuevo reproduce la vida hora a hora", () => {
    const setup: LifeSetup = { game: defaultGameSetup("realistic"), frequency: 8 };
    const db = openSqlite(":memory:");
    const store = LifeStore.open(db);
    const life = Life.create(7, content, optionsOf(setup));
    const from = { engine: "life-1", content: "none", format: 1 };
    const to = { ...from, engine: "life-2" };
    store.setMeta("seed", 7);
    store.setMeta("setup", setup);
    store.setMeta("anchor", life.anchor);
    store.setMeta("versions", from);
    store.save(life.state());
    // La vida avanza con el motor viejo y cruza al nuevo en el tick del límite.
    life.advanceTo(life.now + 3 * 3600);
    const limit = life.now;
    store.save(life.state());
    store.saveSnapshot(life.state());
    store.setMeta("versions", to);
    store.setMeta("replayLimits", [{ tick: limit, from, to }]);
    // Ya con el motor nuevo sigue unas horas y deja un checkpoint.
    life.advanceTo(limit + 6 * 3600);
    store.saveSnapshot(life.state());

    const { input, checkpoints } = replayInputFromStore(store);
    expect(input.from?.tick).toBe(limit);
    const report = replay(input, lifeReplayGame(content, to), {
      checkpoints,
      until: life.now,
    });
    expect(report.divergence).toBeUndefined();
    expect(report.checked).toBeGreaterThanOrEqual(2);
    expect(report.hash).toEqual(life.hash());
    db.close();
  }, 400_000);
});
