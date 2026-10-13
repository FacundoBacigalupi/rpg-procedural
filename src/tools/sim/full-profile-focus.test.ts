import { describe, expect, it } from "vitest";
import {
  defaultGameSetup,
  FULL_PROFILE,
  GAME_CONTENT_KINDS,
  Life,
  optionsOf,
} from "../../game/index.ts";
import { loadContentDir } from "../../persistence/index.ts";
import { type ProcessMeasurement, recordProcess } from "./full-profile.ts";
import { healthDebtFocus } from "./full-profile-focus.ts";

const COVERED = [
  "life.contagion",
  "life.exposure",
  "life.medicine",
  "life.nutrition",
  "life.substances",
  "life.workout",
] as const;

describe("foco de salud y deuda del perfil completo", () => {
  it("con seed fijo ejercita contagio, exposición, medicina, workout, nutrición y sustancias", () => {
    const content = loadContentDir("content", GAME_CONTENT_KINDS);
    const base = optionsOf({ game: defaultGameSetup("realistic"), life: FULL_PROFILE });
    const focus = healthDebtFocus(1, content, base);
    // Derivado y serializable: viaja en `setup.life` y se repite igual desde el seed.
    expect(JSON.parse(JSON.stringify(focus))).toEqual(focus);
    expect(healthDebtFocus(1, content, base)).toEqual(focus);
    const counts = new Map<string, ProcessMeasurement>();
    const life = Life.create(1, content, {
      ...focus,
      runProbe: (id, changes, events) => recordProcess(counts, id, changes, events),
    });
    counts.clear();
    life.advanceTo(life.now + 12 * life.world.clock.day);
    for (const id of COVERED) expect(counts.get(id)?.effectiveCalls ?? 0, id).toBeGreaterThan(0);
  }, 240_000);
});
