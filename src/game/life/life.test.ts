import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, IdAllocator, loadContent } from "../../core/index.ts";
import {
  BODY_STATE,
  checkInvariants,
  hashState,
  LOCATION,
  PERSON,
  SKILL_STATE,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { createLife } from "./create.ts";
import { Life } from "./life.ts";
import { living, PLAYER } from "./world.ts";

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

describe("la vida real", () => {
  const { world, terrain } = createLife(7, content);

  it("el personaje sale de la pre-corrida, vivo y con todo sembrado", () => {
    const me = world.player;
    expect(world.truth.has(PLAYER, me)).toBe(true);
    expect(living(world.truth)).toContain(me);
    for (const id of living(world.truth)) {
      expect(world.truth.get(PERSON, id)).toBeDefined();
      expect(world.truth.get(BODY_STATE, id)).toBeDefined();
      expect(world.truth.get(SKILL_STATE, id)).toBeDefined();
      expect(world.truth.get(LOCATION, id)?.hex).toBe(terrain.site.hex);
    }
    expect(world.scheduler.now).toBe(terrain.population.now);
  });

  it("cumple las invariantes causales", () => {
    expect(checkInvariants({ truth: world.truth, log: world.log })).toEqual([]);
  });

  it("es determinista y el scheduler avanza un día sin romper nada", () => {
    const again = createLife(7, content).world;
    const state = (w: typeof world) => ({
      truth: w.truth,
      log: w.log,
      ledger: w.ledger,
      ids: w.ids.state(),
      scheduler: w.scheduler.state(),
    });
    expect(hashState(state(again))).toEqual(hashState(state(world)));
    world.scheduler.advanceTo(world.scheduler.now + world.clock.day);
    again.scheduler.advanceTo(again.scheduler.now + again.clock.day);
    expect(hashState(state(again))).toEqual(hashState(state(world)));
    expect(checkInvariants({ truth: world.truth, log: world.log })).toEqual([]);
  }, 120_000);
});

describe("retomar una vida", () => {
  it("con el ancla guardada da la misma vida que regenerando el planeta, sin generarlo", () => {
    const options = { frequency: 8 };
    const life = Life.create(7, content, options);
    const anchor = JSON.parse(JSON.stringify(life.anchor)) as typeof life.anchor;
    const { truth, log, ledger, ids, scheduler } = life.state();
    const saved = { truth, log, ledger, ids: new IdAllocator(ids), scheduler };
    const cached = Life.resume(7, content, saved, options, anchor);
    const regenerated = Life.resume(7, content, saved, options);
    expect(cached.hash()).toEqual(regenerated.hash());
    expect(cached.anchor).toEqual(regenerated.anchor);
    expect(cached.player).toBe(life.player);
    // El planeta sigue ahí si alguien lo pide.
    expect(cached.terrain.site.hex).toBe(anchor.hex);
  }, 600_000);
});
