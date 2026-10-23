import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import type { Percept } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { dayPhase, hudPanel } from "./hud.ts";
import { Life } from "./life.ts";
import { characterPanel, inventoryPanel } from "./panels.ts";
import { playerView } from "./view.ts";

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

describe("la barra de arriba (hudPanel)", () => {
  it("el momento del día sigue los crepúsculos de daylight", () => {
    expect([0, 5, 6.9, 7, 16.9, 17, 18.9, 19, 23].map(dayPhase)).toEqual([
      "night",
      "dawn",
      "dawn",
      "day",
      "day",
      "dusk",
      "dusk",
      "night",
      "night",
    ]);
  });

  it("sale de la escena percibida y del panel, sin tocar el mundo", () => {
    const life = Life.create(7, content, { frequency: 8 });
    const w = life.world;
    let seen: readonly Percept[] = [];
    playerView(w, [], { intro: true, onSeen: (p) => (seen = p) });
    const before = [w.scheduler.now, w.log.all().length];
    const character = characterPanel(w);
    const hud = hudPanel(w, character, inventoryPanel(w).coins, seen);
    expect([w.scheduler.now, w.log.all().length]).toEqual(before);
    expect(hud.people.around).toBe(seen.length);
    expect(hud.people.known).toBeLessThanOrEqual(hud.people.around);
    expect(hud.place.home).toBe(character.where.home);
    // Bajo techo el cielo no se ve: solo se oye si llueve o nieva.
    if (hud.place.indoor) expect(["unknown", "rain", "snow"]).toContain(hud.sky);
    expect(hudPanel(w, character, 0, [])).toMatchObject({ people: { around: 0, known: 0 } });
  });
});
