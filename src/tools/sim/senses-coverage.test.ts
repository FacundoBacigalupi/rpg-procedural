import { describe, expect, it } from "vitest";
import {
  defaultGameSetup,
  FULL_PROFILE,
  GAME_CONTENT_KINDS,
  Life,
  optionsOf,
} from "../../game/index.ts";
import { loadContentDir } from "../../persistence/index.ts";
import { FIELD_YIELD, LAW_BELIEFS, lawKeyId } from "../../sim/index.ts";
import { type ProcessMeasurement, recordProcess } from "./full-profile.ts";
import { runFullProfileSeed } from "./full-profile-run.ts";
import { runSensesTurns, SENSES_PONDER_TEXT, SENSES_PROCESSES } from "./senses-coverage.ts";

const content = loadContentDir("content", GAME_CONTENT_KINDS);

function sensesLife() {
  const counts = new Map<string, ProcessMeasurement>();
  const life = Life.create(1, content, {
    ...optionsOf({ game: defaultGameSetup("realistic"), life: FULL_PROFILE }),
    runProbe: (id, changes, events) => recordProcess(counts, id, changes, events),
  });
  counts.clear();
  const plans = runSensesTurns(life);
  return { life, counts, plans };
}

describe("cobertura dirigida de mirar y suponer (perfil2c-senses)", () => {
  it("con el perfil completo, look y ponder del personaje pasan por life.looking y life.ponder", () => {
    const a = sensesLife();
    expect(a.plans.map((p) => p.root.kind === "do" && p.root.verb)).toEqual(["look", "ponder"]);
    for (const id of SENSES_PROCESSES)
      expect(a.counts.get(id)?.effectiveCalls ?? 0, id).toBeGreaterThan(0);
    const log = a.life.world.log.all();
    const pondered = log.find((e) => e.kind === "action.ponder" && e.actors[0] === a.life.player);
    expect(log.some((e) => e.kind === "action.look" && e.actors[0] === a.life.player)).toBe(true);
    if (!pondered) throw new Error("sin action.ponder del personaje");
    // La hipótesis del jugador queda en sus creencias sobre la ley, colgada del evento real.
    const belief = a.life.world.truth.get(LAW_BELIEFS, a.life.player)?.beliefs[
      lawKeyId(FIELD_YIELD)
    ];
    const mine = belief?.hypotheses.filter(
      (w) => w.h.origin.kind === "player" && w.h.origin.eventId === pondered.id,
    );
    expect(mine?.map((w) => w.h.claim)).toEqual([{ kind: "depends", on: "season", high: [1, 2] }]);
    expect(SENSES_PONDER_TEXT).toContain("verano");
    // Determinista: los mismos turnos sobre el mismo seed dejan el mismo mundo.
    expect(sensesLife().life.hash().total).toBe(a.life.hash().total);
  }, 240_000);

  it("el flag senses corre los turnos en la medición del perfil sin violar invariantes", () => {
    const report = runFullProfileSeed(1, {
      seeds: [1],
      years: 1,
      days: 1,
      checkEveryDays: 1,
      senses: true,
    });
    if (!("performance" in report)) throw new Error("la corrida falló");
    expect(report.problems).toEqual([]);
    for (const id of SENSES_PROCESSES)
      expect(report.performance.processes[id]?.effectiveCalls ?? 0, id).toBeGreaterThan(0);
  }, 240_000);
});
