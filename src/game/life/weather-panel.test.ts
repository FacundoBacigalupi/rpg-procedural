import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent, Rng } from "../../core/index.ts";
import {
  dailyWeather,
  dayOf,
  expectedMeanC,
  foreseenRainChance,
  persistence,
  rainedToday,
  TYPICAL_HALF_RANGE_C,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { MISREAD_SD_C } from "./forecast.ts";
import { Life } from "./life.ts";
import {
  airFeel,
  nightCold,
  rainBand,
  rainTrustAt,
  seasonOf,
  trustAt,
  weatherPanel,
} from "./weather-panel.ts";

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

/** Todos los valores hoja de un objeto. */
function leaves(x: unknown): unknown[] {
  if (x === null || typeof x !== "object") return [x];
  return Object.values(x).flatMap(leaves);
}

describe("el pronóstico del jugador en el panel del cielo", () => {
  const life = Life.create(7, content);
  const w = life.world;

  it("dice todo en palabras: ningún número del mundo sale en el panel ni en su texto", () => {
    const panel = weatherPanel(w);
    expect(leaves(panel).every((v) => typeof v === "string")).toBe(true);
    expect(Object.keys(panel).sort()).toEqual(["airNow", "outlook", "rain", "season"]);
    for (const r of panel.rain) expect(Object.keys(r).sort()).toEqual(["ahead", "chance", "trust"]);
    for (const o of panel.outlook)
      expect(Object.keys(o).sort()).toEqual(["ahead", "night", "trust"]);
  });

  it("es determinista y no escribe nada ni gasta tiempo", () => {
    const now = w.scheduler.now;
    const events = w.log.all().length;
    expect(weatherPanel(w)).toEqual(weatherPanel(w));
    expect(weatherPanel(Life.create(7, content).world)).toEqual(weatherPanel(w));
    expect(w.scheduler.now).toBe(now);
    expect(w.log.all().length).toBe(events);
  });

  it("no filtra el tiempo futuro: sale solo de la estación y de lo visto hoy", () => {
    const today = dayOf(w.clock, w.scheduler.now + Math.round((w.map.lonDeg / 360) * w.clock.day));
    const root = Rng.root(w.seed);
    const misread = root.fork("forecast", w.player, today).normal(0, MISREAD_SD_C);
    const seen = dailyWeather(w.map.climate, w.clock, today, root).tempMeanC + misread;
    const dev = seen - expectedMeanC(w.map.climate, w.clock, today);
    const panel = weatherPanel(w);
    for (const [i, days] of [1, 3, 7].entries()) {
      let min = Number.POSITIVE_INFINITY;
      for (let k = 1; k <= days; k++) {
        min = Math.min(
          min,
          expectedMeanC(w.map.climate, w.clock, today + k) +
            persistence(k) * dev -
            TYPICAL_HALF_RANGE_C,
        );
      }
      expect(panel.outlook[i]?.night).toBe(nightCold(Math.round(min * 10) / 10));
    }
  });

  it("la lluvia sale sólo de lo visto hoy y del clima del lugar, no del tiempo que viene", () => {
    const today = dayOf(w.clock, w.scheduler.now + Math.round((w.map.lonDeg / 360) * w.clock.day));
    const wet = rainedToday(w.map.climate, w.clock, Rng.root(w.seed), today);
    const panel = weatherPanel(w);
    for (const [i, days] of [1, 3, 7].entries())
      expect(panel.rain[i]?.chance).toBe(
        rainBand(foreseenRainChance(w.map.climate, today, days, wet)),
      );
    expect(panel.rain.map((r) => r.ahead)).toEqual(["tomorrow", "three_days", "week"]);
    expect(rainBand(0.05)).toBe("dry");
    expect(rainBand(0.9)).toBe("sure");
    expect(rainTrustAt(101, 3)).toBe("season_only");
    expect(rainTrustAt(99, 1)).toBe("fair");
    expect(rainTrustAt(99, 3)).toBe("weak");
  });

  it("el error de lectura es suyo: otro personaje, otra lectura del mismo día", () => {
    const today = dayOf(w.clock, w.scheduler.now);
    const root = Rng.root(w.seed);
    const a = root.fork("forecast", w.player, today).normal(0, MISREAD_SD_C);
    const b = root.fork("forecast", "otra-persona", today).normal(0, MISREAD_SD_C);
    expect(a).not.toBe(b);
  });

  it("las bandas van de menos a más y la fe se pierde con el plazo", () => {
    expect([-20, 0, 10, 18, 25, 35].map(airFeel)).toEqual([
      "bitter",
      "cold",
      "cool",
      "mild",
      "warm",
      "hot",
    ]);
    expect([-15, -2, 5, 12, 20].map(nightCold)).toEqual([
      "hard_frost",
      "frost",
      "cold",
      "cool",
      "mild",
    ]);
    expect([1, 3, 7].map(trustAt)).toEqual(["fair", "weak", "season_only"]);
    expect(seasonOf(0.1, 45)).toBe("spring");
    expect(seasonOf(0.1, -45)).toBe("autumn");
  });
});
