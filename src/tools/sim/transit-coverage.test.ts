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

// perfil2-coverage-transit-gap: en el perfil completo el viaje NPC (`npc.journey`, `life.transit`) da
// 0 salidas porque `npcRainForecast` hace esperar al viajero un día (`wait`) y la decisión `move` de un
// recado vence en un día (`ctx.now - decision.at >= day`), así que nunca sale: ver el ROADMAP
// (`perfil2-rain-wait-persist`). Este test fija que, sin el pronóstico de lluvia (y el riego que
// depende de él), los recados del perfil sí abren viajes, llegan y se cruzan con gente.
describe("cobertura de tránsito NPC con el perfil completo sin pronóstico de lluvia", () => {
  it("los recados abren viajes que llegan, con invariantes sanos", () => {
    const content = loadContentDir("content", GAME_CONTENT_KINDS);
    const setup = {
      game: defaultGameSetup("realistic"),
      life: {
        ...FULL_PROFILE,
        npcRainForecast: false,
        npcFieldWatering: false,
        npcFieldSowing: false,
        npcFieldShared: false,
        npcSowSeed: false,
      },
    };
    assertLifeDependencies(optionsOf(setup));
    const life = Life.create(1, content, optionsOf(setup));
    life.advanceTo(life.now + 30 * life.world.clock.day);
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
