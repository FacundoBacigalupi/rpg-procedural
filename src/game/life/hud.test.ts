import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import type { EventId } from "../../core/index.ts";
import { type ContentSource, loadContent } from "../../core/index.ts";
import {
  type BuildingRecord,
  CORE_NORMAL_C,
  EMOTIONS,
  LOCATION,
  type Percept,
  THERMAL,
  VILLAGE_SQUARE,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { dayPhase, hudPanel, MAX_SEEN_BUILDINGS, seenBuildings, warmthOf } from "./hud.ts";
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
    // Cada silueta lleva solo lo que leyó la mirada: sin figura leída, ni edad ni sexo.
    expect(hud.people.figures).toHaveLength(seen.length);
    seen.forEach((p, i) => {
      const f = hud.people.figures[i];
      expect(f?.known).toBe(p.detail === "identified");
      if (p.fields.figure === undefined) expect(f?.age).toBeUndefined();
      else expect(f?.age).toBe((p.fields.figure.value as { age: string }).age);
    });
    // La aldea por defecto no simula fuegos: no se sabe si hay uno encendido.
    expect(hud.place.fire).toBeUndefined();
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

describe("edificios en el fondo", () => {
  const building = (x: number, y: number, extra: Partial<BuildingRecord> = {}): BuildingRecord =>
    ({
      type: "cottage",
      at: { x, y },
      graph: { spaces: [], edges: [], entrance: "e", door: "doorway" },
      components: [
        {
          part: "walls",
          area: 30,
          materials: [
            { material: "clay", grams: 900, origin: "e:x" },
            { material: "timber", grams: 100, origin: "e:x" },
          ],
          condition: 0.1,
          quality: 0.5,
          defects: [],
        },
        {
          part: "roof",
          area: 30,
          materials: [{ material: "thatch", grams: 300, origin: "e:x" }],
          condition: 0.7,
          quality: 0.5,
          defects: [],
        },
      ],
      ...extra,
    }) as unknown as BuildingRecord;

  it("ve los cercanos a la luz que hay, de oeste a este, con material, desgaste, ruina y fuego", () => {
    const rows = [
      { id: "b:1", b: building(40, 0) },
      { id: "b:2", b: building(-60, 10, { type: "granary" }) },
      { id: "b:3", b: building(0, 300) },
      {
        id: "b:4",
        b: building(10, -20, {
          ruin: { cause: "fire", rebuild: "same" },
          fire: { intensity: 0.5 } as NonNullable<BuildingRecord["fire"]>,
        }),
      },
    ];
    const seen = seenBuildings(rows, { x: 0, y: 0 }, 250);
    expect(seen.map((b) => b.x)).toEqual([-60, 10, 40]);
    expect(seen[0]).toMatchObject({ type: "granary", wall: "clay", roof: "thatch", worn: 2 });
    expect(seen[1]).toMatchObject({ ruin: true, burning: true, d: 20 });
    // De noche, solo lo que está encima; el propio no se cuenta.
    expect(seenBuildings(rows, { x: 0, y: 0 }, 30).map((b) => b.x)).toEqual([10]);
    expect(seenBuildings(rows, { x: 0, y: 0 }, 30, "b:4")).toEqual([]);
  });

  it("en la vida: adentro sabe en qué edificio está; en la plaza ve los de alrededor", () => {
    const life = Life.create(7, content, { frequency: 8 });
    const w = life.world;
    const at = w.truth.get(LOCATION, w.player);
    const character = characterPanel(w);
    const hud = hudPanel(w, character, 0, []);
    if (hud.place.indoor) expect(hud.place.building?.type).toBeTruthy();
    if (!at) return;
    w.truth.set(LOCATION, w.player, { ...at, space: VILLAGE_SQUARE });
    const out = hudPanel(w, characterPanel(w), 0, []);
    expect(out.place.indoor).toBe(false);
    expect(out.place.building).toBeUndefined();
    expect(Array.isArray(out.place.buildings)).toBe(true);
    expect(out.place.buildings?.length ?? 0).toBeLessThanOrEqual(MAX_SEEN_BUILDINGS);
  });
});
