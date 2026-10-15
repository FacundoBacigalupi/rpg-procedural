import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import { checkInvariants } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { optInParts } from "./create.ts";
import { engineOptions, Life } from "./life.ts";
import { FULL_PROFILE, validateLifeDependencies } from "./profile.ts";
import { cropStarts, SOW_FLOOR, SOW_GRACE_DAYS, SOW_LATE_LOSS, SOWN, sowYield } from "./sowing.ts";

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

describe("siembra del campo (puro)", () => {
  it("sembrar tarde baja el rinde, con gracia y piso", () => {
    expect(sowYield(0)).toBe(1);
    expect(sowYield(SOW_GRACE_DAYS)).toBe(1);
    expect(sowYield(SOW_GRACE_DAYS + 5)).toBeCloseTo(1 - 5 * SOW_LATE_LOSS, 10);
    expect(sowYield(1000)).toBe(SOW_FLOOR);
  });

  it("la temporada empieza el primer día con rinde tras los días sin él", () => {
    // Años de 10 días: rinde del día 3 al 7 de cada uno.
    const season = (d: number) => {
      const m = ((d % 10) + 10) % 10;
      return m >= 3 && m <= 7 ? 1 : 0;
    };
    const start = cropStarts(season, 10, 3);
    expect(start(2)).toBeUndefined();
    expect(start(3)).toBe(3);
    expect(start(7)).toBe(3);
    expect(start(13)).toBe(13);
    expect(start(15)).toBe(13);
    // Sin invierno no hay ventana.
    expect(cropStarts(() => 1, 10, 3)(25)).toBeUndefined();
  });

  it("es opt-in, pide el riego y el perfil lo enciende desde life-22", () => {
    expect(optInParts({})).toEqual({});
    expect(optInParts({ npcFieldSowing: true })).toEqual({ npcFieldSowing: true });
    expect(
      validateLifeDependencies({ npcFieldSowing: true }).some(
        (i) => i.requires === "npcFieldWatering",
      ),
    ).toBe(true);
    expect(FULL_PROFILE.npcFieldSowing).toBe(true);
    expect(optInParts({ npcFieldSowing: true, legacyNoFieldSowing: true })).toEqual({});
    expect(engineOptions("life-21", FULL_PROFILE).legacyNoFieldSowing).toBe(true);
    expect(engineOptions("life-22", FULL_PROFILE).legacyNoFieldSowing).toBeUndefined();
  });
});

describe("siembra del campo en la vida (opt-in)", () => {
  const base = {
    npcVerbs: ["move"],
    npcJourneyDays: 6,
    npcCloak: true,
    npcForecast: true,
    npcRainForecast: true,
    npcFieldWatering: true,
  } as const;

  function run(sowing: boolean) {
    const life = Life.create(4, content, {
      ...base,
      ...(sowing ? { npcFieldSowing: true } : {}),
    });
    life.advanceTo(life.now + 150 * 86_400);
    return life;
  }

  const sowings = (life: Life) => life.world.log.all().filter((e) => e.kind === "routine.sown");

  it("apagado nadie siembra", () => {
    expect(sowings(run(false))).toHaveLength(0);
  }, 240_000);

  it("la temporada se siembra y conserva", () => {
    const life = run(true);
    expect(sowings(life).length).toBeGreaterThan(0);
    for (const e of sowings(life)) {
      const d = e.data as { start: number; lateDays: number };
      expect(d.lateDays).toBeGreaterThanOrEqual(0);
      const who = e.actors[0] as never;
      expect(life.world.truth.get(SOWN, who)?.start).toBeDefined();
    }
    expect(
      checkInvariants({ truth: life.world.truth, log: life.world.log, ledger: life.world.ledger }),
    ).toEqual([]);
  }, 240_000);

  it("es determinista", () => {
    expect(run(true).hash()).toEqual(run(true).hash());
  }, 240_000);
});
