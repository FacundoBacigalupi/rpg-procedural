import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";
import { DREAM_EVENT } from "./sleep.ts";

const DAY = 86400;

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}

// Hash de develop: apagado no debe moverlo.
const BASE_HASH = "b829bb7436cffc764da33660c899d578132ea796fdf7f86e47af651e5310c12f";

describe("sueños con contenido (life)", () => {
  const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
  const run = (dreams: boolean, days: number) => {
    const l = Life.create(3, content, dreams ? { dreams: true } : {});
    l.advanceTo(l.now + DAY * days);
    return l;
  };

  it("apagado deja el hash de develop y ningún sueño", () => {
    const off = Life.create(3, content, {});
    expect(off.hash().total).toBe(BASE_HASH);
    const l = run(false, 20);
    expect(l.world.log.all().some((e) => e.kind === DREAM_EVENT)).toBe(false);
  }, 120_000);

  it("encendido es determinista y cada sueño cita eventos reales", () => {
    const a = run(true, 20);
    const b = run(true, 20);
    expect(a.hash().total).toBe(b.hash().total);
    const dreams = a.world.log.all().filter((e) => e.kind === DREAM_EVENT);
    const ids = new Set(a.world.log.all().map((e) => e.id));
    for (const d of dreams) {
      expect(d.actors).toHaveLength(1);
      expect(d.causes.length).toBeGreaterThan(0);
      for (const c of d.causes) if (c.kind === "event") expect(ids.has(c.event)).toBe(true);
    }
  }, 240_000);
});
