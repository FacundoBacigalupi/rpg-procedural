import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import { PERSON } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../index.ts";
import { type EnvironmentMemory, environmentPanel, HALF_LIFE, NOTICEABLE } from "./environment.ts";
import { Life } from "./index.ts";
import { DEFAULT_SUGGESTIONS, suggestions } from "./suggest.ts";

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

describe("opciones sugeridas", () => {
  it("salen ordenadas por saliencia, siempre hay algo y son validables", () => {
    const life = Life.create(7, content);
    const all = suggestions(life.world);
    expect(all.length).toBeGreaterThan(0);
    for (let i = 1; i < all.length; i++) {
      expect(all[i - 1]?.salience ?? 0).toBeGreaterThanOrEqual(all[i]?.salience ?? 0);
    }
    expect(suggestions(life.world, DEFAULT_SUGGESTIONS).length).toBeLessThanOrEqual(
      DEFAULT_SUGGESTIONS,
    );
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length);
  }, 60_000);

  it("la sed se impone sobre el resto una vez que el cuerpo avisa", () => {
    const life = Life.create(7, content);
    const w = life.world;
    for (let d = 0; d < 3; d++) {
      life.advanceTo(life.now + w.clock.day / 2);
      if (suggestions(w).some((s) => s.kind === "drink")) break;
    }
    const top = suggestions(w)[0];
    expect(w.truth.get(PERSON, w.player)).toBeDefined();
    if (top?.kind === "drink") expect(top.salience).toBeGreaterThanOrEqual(0.8);
  }, 120_000);

  it("es determinista", () => {
    const run = () => suggestions(Life.create(7, content).world).map((s) => s.id);
    expect(run()).toEqual(run());
  }, 60_000);
});

describe("panel de entorno", () => {
  it("se habitúa con el tiempo y se renueva al mirar", () => {
    const life = Life.create(7, content);
    const w = life.world;
    const memory: EnvironmentMemory = new Map();
    const first = environmentPanel(w, memory);
    expect(first.length).toBeGreaterThan(0);
    expect(first.every((i) => i.salience === 1)).toBe(true);
    // Pasado el doble de la vida media más larga, lo sostenido deja de notarse...
    life.advanceTo(life.now + 3 * Math.max(...Object.values(HALF_LIFE)));
    const later = environmentPanel(w, memory);
    expect(later.every((i) => i.salience >= NOTICEABLE)).toBe(true);
    expect(later.length).toBeLessThanOrEqual(first.length + 3);
    // ...y mirar a propósito lo vuelve a poner.
    const again = environmentPanel(w, memory, { attended: true });
    expect(again.length).toBeGreaterThan(0);
    expect(again.every((i) => i.salience === 1)).toBe(true);
  }, 120_000);
});
