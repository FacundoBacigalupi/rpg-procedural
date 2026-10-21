import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import { BODY_STATE, checkInvariants, ENTITY, PERSON } from "../../sim/index.ts";
import { createLife } from "../life/create.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { buildChronicle } from "./chronicle.ts";
import { epilogueSection, renderEpilogue, runEpilogue, trackedOf } from "./epilogue.ts";

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
const marks = { mode: "realista", inspected: false };

function dead(seed: number) {
  const { world } = createLife(seed, content);
  const sched = world.scheduler;
  const body = world.truth.get(BODY_STATE, world.player);
  if (!body) throw new Error("sin cuerpo");
  const entered = sched.now;
  sched.advanceTo(entered + 3 * world.clock.day);
  world.truth.set(BODY_STATE, world.player, {
    ...body,
    death: { cause: "starvation", at: sched.now + world.clock.day },
  });
  sched.advanceTo(sched.now + world.clock.day);
  return { world, chronicle: buildChronicle(world, entered, marks) };
}

describe("el epílogo corto", { timeout: 120_000 }, () => {
  it("sigue a la familia y al hogar, cita muertes reales y no rompe invariantes", () => {
    const { world, chronicle } = dead(11);
    const tracked = trackedOf(world, chronicle);
    const home = world.truth.get(PERSON, world.player)?.household;
    for (const [id, rel] of tracked) {
      expect(id).not.toBe(world.player);
      if (rel === "household") expect(world.truth.get(PERSON, id)?.household).toBe(home);
    }
    const ep = runEpilogue(world, chronicle, [0.05]);
    expect(ep.sections).toHaveLength(1);
    const s = ep.sections[0];
    expect(s?.at).toBe(chronicle.died + Math.round(0.05 * world.clock.year));
    for (const f of s?.facts ?? []) {
      if (f.kind === "died") {
        expect(world.log.has(f.event)).toBe(true);
        expect(world.truth.get(ENTITY, f.who)?.endedAt).toBeDefined();
      }
      if (f.kind === "alive") expect(world.truth.get(ENTITY, f.who)?.endedAt).toBeUndefined();
    }
    expect(s?.facts.some((f) => f.kind === "household")).toBe(true);
    expect(renderEpilogue(ep, () => "alguien")).toContain("después:");
    expect(checkInvariants({ truth: world.truth, log: world.log })).toEqual([]);
  });

  it("es determinista y se corta si ya no queda nadie", () => {
    const a = dead(5);
    const b = dead(5);
    expect(runEpilogue(a.world, a.chronicle, [0.05])).toEqual(
      runEpilogue(b.world, b.chronicle, [0.05]),
    );
    const none = epilogueSection(a.world, a.chronicle, new Map(), 1);
    expect(none.ended).toBe(true);
  });
});
