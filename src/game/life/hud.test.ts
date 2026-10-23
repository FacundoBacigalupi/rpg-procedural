import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import type { EventId } from "../../core/index.ts";
import { type ContentSource, loadContent } from "../../core/index.ts";
import { CORE_NORMAL_C, EMOTIONS, type Percept, THERMAL } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { dayPhase, hudPanel, warmthOf } from "./hud.ts";
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

  it("el frío o el calor sale del núcleo, en bandas; sin fila, normal", () => {
    expect([undefined, 34, 36, 37, 38, 39.5].map(warmthOf)).toEqual([
      "normal",
      "freezing",
      "cold",
      "normal",
      "hot",
      "burning",
    ]);
  });

  it("el ánimo es la emoción propia que todavía dura y se apaga con el tiempo", () => {
    const life = Life.create(7, content, { frequency: 8 });
    const w = life.world;
    const character = characterPanel(w);
    expect(hudPanel(w, character, 0, []).mood).toEqual({
      feeling: null,
      strength: 0,
      burden: null,
    });
    w.truth.set(EMOTIONS, w.player, {
      signals: [
        {
          owner: w.player,
          emotion: "sadness",
          intensity: 0.9,
          originEventId: "e:test" as EventId,
          at: w.scheduler.now,
          appraisalTheme: "loss",
        },
        {
          owner: w.player,
          emotion: "joy",
          intensity: 0.3,
          originEventId: "e:test" as EventId,
          at: w.scheduler.now,
          appraisalTheme: "success",
        },
      ],
    });
    w.truth.set(THERMAL, w.player, { coreC: CORE_NORMAL_C - 1, at: w.scheduler.now });
    const hud = hudPanel(w, character, 0, []);
    expect(hud.mood).toMatchObject({ feeling: "sadness", strength: 2 });
    expect(hud.warmth).toBe("cold");
    // Una semana después la tristeza ya no se nota.
    const old = w.scheduler.now - 7 * 24 * 3600;
    const signals = w.truth.get(EMOTIONS, w.player)?.signals ?? [];
    w.truth.set(EMOTIONS, w.player, { signals: signals.map((x) => ({ ...x, at: old })) });
    expect(hudPanel(w, character, 0, []).mood.feeling).toBeNull();
  });
});
