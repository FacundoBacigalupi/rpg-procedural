import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import {
  checkInvariants,
  DRY_FLOOR,
  irrigationBoost,
  SOIL_DAYS,
  SOIL_FULL_MM,
  wetness,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { optInParts } from "./create.ts";
import { RAIN_WAIT_CHANCE } from "./forecast.ts";
import { DRY_SOIL_MM, fieldIrrigationMm, IRRIGATED } from "./irrigation.ts";
import { engineOptions, Life } from "./life.ts";
import { FULL_PROFILE, validateLifeDependencies } from "./profile.ts";

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

describe("riego del campo (puro)", () => {
  it("el riego sube lo mojado del suelo y nunca pasa del lleno", () => {
    expect(irrigationBoost(0, 0)).toBe(1);
    expect(irrigationBoost(0, 5)).toBeGreaterThan(1);
    expect(irrigationBoost(0, 5)).toBeCloseTo(wetness(5) / DRY_FLOOR, 10);
    expect(irrigationBoost(SOIL_FULL_MM, 10)).toBe(1);
    expect(irrigationBoost(10, 100)).toBeCloseTo(1 / wetness(10), 10);
  });

  it("es opt-in, pide la lluvia creída y el perfil lo enciende desde life-21", () => {
    expect(optInParts({})).toEqual({});
    expect(optInParts({ npcFieldWatering: true })).toEqual({ npcFieldWatering: true });
    expect(
      validateLifeDependencies({ npcFieldWatering: true }).some(
        (i) => i.requires === "npcRainForecast",
      ),
    ).toBe(true);
    expect(FULL_PROFILE.npcFieldWatering).toBe(true);
    expect(optInParts({ npcFieldWatering: true, legacyNoFieldWatering: true })).toEqual({});
    expect(engineOptions("life-20", FULL_PROFILE).legacyNoFieldWatering).toBe(true);
    expect(engineOptions("life-21", FULL_PROFILE).legacyNoFieldWatering).toBeUndefined();
  });
});

describe("riego del campo en la vida (opt-in)", () => {
  const base = {
    npcVerbs: ["move"],
    npcJourneyDays: 6,
    npcCloak: true,
    npcForecast: true,
    npcRainForecast: true,
  } as const;

  function run(watering: boolean) {
    const life = Life.create(4, content, {
      ...base,
      ...(watering ? { npcFieldWatering: true } : {}),
    });
    life.advanceTo(life.now + 60 * 86_400);
    return life;
  }

  const irrigations = (life: Life) =>
    life.world.log.all().filter((e) => e.kind === "routine.irrigated");

  it("apagado nadie riega", () => {
    expect(irrigations(run(false))).toHaveLength(0);
  }, 240_000);

  it("riega con el suelo seco y sin creer que llueva, deja el asiento y conserva", () => {
    const life = run(true);
    const events = irrigations(life);
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      const d = e.data as { mm: number; rainChance: number; soilMm: number };
      expect(d.soilMm).toBeLessThan(DRY_SOIL_MM);
      expect(d.rainChance).toBeLessThan(RAIN_WAIT_CHANCE);
      const who = e.actors[0] as never;
      const entries = life.world.truth.get(IRRIGATED, who)?.entries ?? [];
      expect(entries.length).toBeLessThanOrEqual(SOIL_DAYS);
    }
    const day = Math.floor(life.now / 86_400);
    expect(fieldIrrigationMm(life.world.truth, day)).toBeGreaterThanOrEqual(0);
    expect(
      checkInvariants({ truth: life.world.truth, log: life.world.log, ledger: life.world.ledger }),
    ).toEqual([]);
  }, 240_000);

  it("es determinista", () => {
    expect(run(true).hash()).toEqual(run(true).hash());
  }, 240_000);
});
