import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type ContentSource,
  EARTHLIKE_CLOCK,
  externalAccount,
  ledgerUnit,
  loadContent,
} from "../../core/index.ts";
import { checkInvariants } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { ledgerConfigOf, lifeTerrain, optInParts } from "./create.ts";
import { engineOptions, Life } from "./life.ts";
import { FULL_PROFILE, validateLifeDependencies } from "./profile.ts";
import {
  cropStarts,
  FROST_C,
  SEED_GRAMS,
  SOW_FLOOR,
  SOW_GRACE_DAYS,
  SOW_LATE_LOSS,
  SOW_MAX_WAIT_DAYS,
  SOWN,
  SOWN_FIELD,
  sowYield,
  wantsToSow,
} from "./sowing.ts";

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

describe("campo compartido con el jugador y los dormidos (opt-in)", () => {
  const base = {
    npcVerbs: ["move"],
    npcJourneyDays: 6,
    npcCloak: true,
    npcForecast: true,
    npcRainForecast: true,
    npcFieldWatering: true,
    npcFieldSowing: true,
  } as const;

  function run(shared: boolean) {
    const life = Life.create(4, content, { ...base, ...(shared ? { npcFieldShared: true } : {}) });
    life.advanceTo(life.now + 150 * 86_400);
    return life;
  }

  it("es opt-in, pide el riego y el perfil lo enciende desde life-23", () => {
    expect(optInParts({})).toEqual({});
    expect(optInParts({ npcFieldShared: true })).toEqual({ npcFieldShared: true });
    expect(
      validateLifeDependencies({ npcFieldShared: true }).some(
        (i) => i.requires === "npcFieldWatering",
      ),
    ).toBe(true);
    expect(FULL_PROFILE.npcFieldShared).toBe(true);
    expect(optInParts({ npcFieldShared: true, legacyNoFieldShared: true })).toEqual({});
    expect(engineOptions("life-22", FULL_PROFILE).legacyNoFieldShared).toBe(true);
    expect(engineOptions("life-23", FULL_PROFILE).legacyNoFieldShared).toBeUndefined();
  });

  it("conserva y es determinista", () => {
    const life = run(true);
    expect(
      checkInvariants({ truth: life.world.truth, log: life.world.log, ledger: life.world.ledger }),
    ).toEqual([]);
    expect(run(true).hash()).toEqual(life.hash());
  }, 240_000);
});

describe("semilla del ledger y helada creída (opt-in)", () => {
  const base = {
    npcVerbs: ["move"],
    npcJourneyDays: 6,
    npcCloak: true,
    npcForecast: true,
    npcRainForecast: true,
    npcFieldWatering: true,
    npcFieldSowing: true,
  } as const;

  function run(seed: boolean) {
    const life = Life.create(4, content, { ...base, ...(seed ? { npcSowSeed: true } : {}) });
    life.advanceTo(life.now + 200 * 86_400);
    return life;
  }
  const kinds = (life: Life, kind: string) => life.world.log.all().filter((e) => e.kind === kind);
  const grain = ledgerUnit("good:grain");

  it("es opt-in, pide la siembra y el perfil lo enciende desde life-24", () => {
    expect(optInParts({})).toEqual({});
    expect(optInParts({ npcSowSeed: true })).toEqual({ npcSowSeed: true });
    expect(
      validateLifeDependencies({ npcSowSeed: true }).some((i) => i.requires === "npcFieldSowing"),
    ).toBe(true);
    expect(FULL_PROFILE.npcSowSeed).toBe(true);
    expect(optInParts({ npcSowSeed: true, legacyNoSowSeed: true })).toEqual({});
    expect(engineOptions("life-23", FULL_PROFILE).legacyNoSowSeed).toBe(true);
    expect(engineOptions("life-24", FULL_PROFILE).legacyNoSowSeed).toBeUndefined();
    expect(ledgerConfigOf(content).externals[SOWN_FIELD]).toBeUndefined();
    expect(ledgerConfigOf(content, undefined, true).externals[SOWN_FIELD]).toEqual([grain]);
  });

  it("la semilla sale de la despensa, queda en la tierra y vuelve; el ledger cierra", () => {
    const life = run(true);
    const sown = kinds(life, "routine.sown");
    expect(sown.length).toBeGreaterThan(0);
    for (const e of sown) expect((e.data as { seedGrams: number }).seedGrams).toBe(SEED_GRAMS);
    const back = kinds(life, "routine.seed_returned");
    // Lo que está en la tierra es lo sembrado menos lo devuelto.
    expect(life.world.ledger.balance(externalAccount(SOWN_FIELD), grain)).toBe(
      (sown.length - back.length) * SEED_GRAMS,
    );
    expect(
      checkInvariants({ truth: life.world.truth, log: life.world.log, ledger: life.world.ledger }),
    ).toEqual([]);
  }, 240_000);

  it("apagado no hay semilla ni cuenta de la tierra, y es determinista", () => {
    const off = run(false);
    expect(kinds(off, "routine.seed_returned")).toHaveLength(0);
    expect(off.world.ledger.config.externals[SOWN_FIELD]).toBeUndefined();
    expect(run(true).hash()).toEqual(run(true).hash());
  }, 360_000);

  it("quien cree que va a helar no siembra, y sin la opción no mira la helada", () => {
    const { map } = lifeTerrain(4, content);
    const o = { map, clock: EARTHLIKE_CLOCK, seed: 4 as never };
    for (const who of ["a", "b", "c", "d"]) {
      for (let day = 0; day < 720; day++) {
        expect(wantsToSow(o, who, day, day, 0).frostC).toBeUndefined();
        const on = wantsToSow(o, who, day, day, 0, true);
        if (on.frostC !== undefined) {
          expect(on.sow).toBe(false);
          expect(on.frostC).toBeLessThanOrEqual(FROST_C);
        }
        // Pasada la espera máxima siembra igual, helada o no.
        expect(wantsToSow(o, who, day, day - SOW_MAX_WAIT_DAYS, 0, true).sow).toBe(true);
      }
    }
  });
});
