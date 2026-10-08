import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import { BODY_STATE, checkInvariants, ENTITY } from "../../sim/index.ts";
import { createLife } from "../life/create.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { buildChronicle } from "./chronicle.ts";
import { renderChronicle } from "./render.ts";

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

/** Una vida en la que el personaje muere de hambre a los pocos días. */
function starved(seed: number) {
  const { world } = createLife(seed, content);
  const sched = world.scheduler;
  const body = world.truth.get(BODY_STATE, world.player);
  if (!body) throw new Error("sin cuerpo");
  const entered = sched.now;
  sched.advanceTo(entered + 3 * world.clock.day);
  world.truth.set(BODY_STATE, world.player, {
    ...body,
    death: { cause: "starvation", at: sched.now + 2 * world.clock.day },
  });
  sched.advanceTo(sched.now + 2 * world.clock.day);
  return { world, entered };
}

describe("la crónica mínima", { timeout: 60_000 }, () => {
  it("no hay crónica mientras el personaje vive", () => {
    const { world } = createLife(11, content);
    expect(() => buildChronicle(world, world.scheduler.now, marks)).toThrow(/vivo/);
  });

  it("dice la causa real, cita eventos que existen y cierra con la muerte", () => {
    const { world, entered } = starved(11);
    expect(world.truth.get(ENTITY, world.player)?.endedAt).toBeDefined();
    const c = buildChronicle(world, entered, marks);
    expect(c.death.cause).toBe("starvation");
    for (const id of c.sources) expect(world.log.has(id)).toBe(true);
    expect(c.chapters.at(-1)?.title.closedBy).toBe("death");
    expect(c.chapters[0]?.span.from).toBe(entered);
    for (let i = 1; i < c.chapters.length; i++) {
      expect(c.chapters[i]?.span.from).toBe(c.chapters[i - 1]?.span.to);
    }
    const text = renderChronicle(
      c,
      world.clock,
      (id) => world.log.get(id),
      () => "alguien",
    );
    expect(text).toContain("murió de hambre");
    expect(checkInvariants({ truth: world.truth, log: world.log })).toEqual([]);
  });

  it("es determinista: mismo seed, misma crónica", () => {
    const a = starved(5);
    const b = starved(5);
    expect(buildChronicle(a.world, a.entered, marks)).toEqual(
      buildChronicle(b.world, b.entered, marks),
    );
  });
});
