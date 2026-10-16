import { describe, expect, it } from "vitest";
import {
  assertLifeDependencies,
  defaultGameSetup,
  FULL_PROFILE,
  GAME_CONTENT_KINDS,
  Life,
  optionsOf,
} from "../../game/index.ts";
import { loadContentDir } from "../../persistence/index.ts";
import { checkInvariants } from "../../sim/index.ts";

// perfil2-rain-wait-persist: en el perfil completo (con `npcRainForecast`) la espera por lluvia del
// viajero no pierde el recado `move` por el vencimiento diario: los recados abren viajes que llegan.
describe("cobertura de tránsito NPC con el perfil completo", () => {
  it("los recados abren viajes que llegan, con invariantes sanos", () => {
    const content = loadContentDir("content", GAME_CONTENT_KINDS);
    const setup = { game: defaultGameSetup("realistic"), life: { ...FULL_PROFILE } };
    assertLifeDependencies(optionsOf(setup));
    const life = Life.create(1, content, optionsOf(setup));
    life.advanceTo(life.now + 45 * life.world.clock.day);
    const world = life.world;
    const count = (kind: string, what?: string) =>
      world.log
        .all()
        .filter(
          (e) =>
            e.kind === kind && (what === undefined || (e.data as { what?: string }).what === what),
        ).length;
    expect(count("npc.journey", "started")).toBeGreaterThan(0);
    expect(count("npc.journey", "arrived")).toBeGreaterThan(0);
    expect(count("action.move")).toBeGreaterThan(0);
    expect(checkInvariants({ truth: world.truth, log: world.log, ledger: world.ledger })).toEqual(
      [],
    );
  }, 300_000);
});
