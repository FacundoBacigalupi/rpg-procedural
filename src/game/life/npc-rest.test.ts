import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, loadContent } from "../../core/index.ts";
import { hexPath, LOCATION, localHour, PERSON, PLACE } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { NPC_DECISION } from "./decide.ts";
import { Life } from "./life.ts";
import { REST_GAP_HOURS, restDue } from "./npc-verbs.ts";
import { ROUTINE } from "./routine.ts";
import { living } from "./world.ts";

describe("restDue", () => {
  const H = 3600;
  it("toca de noche, una vez por noche; de día nunca", () => {
    expect(restDue(ROUTINE.sleep, undefined, 0)).toBe(true);
    expect(restDue(2, undefined, 0)).toBe(true);
    expect(restDue(ROUTINE.wake, undefined, 0)).toBe(false);
    expect(restDue(12, undefined, 0)).toBe(false);
    // Ya paró hace poco: no vuelve a parar la misma noche; pasadas las horas, sí.
    expect(restDue(23, 0, 3 * H)).toBe(false);
    expect(restDue(23, 0, REST_GAP_HOURS * H)).toBe(true);
  });
});

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

describe("el viajero para a dormir de noche (opt-in)", () => {
  it("interrumpe el tramo en las horas de sueño, duerme y sigue; una parada por noche", () => {
    const life = Life.create(7, content, {
      npcVerbs: ["move"],
      npcJourneyDays: 6,
      npcNightRest: true,
      npcPace: "fast",
    });
    const w = life.world;
    const npc = living(w.truth).find(
      (x) =>
        x !== life.player && (w.truth.get(PERSON, x)?.born ?? 0) < life.now - 20 * 365 * 86_400,
    ) as AgentId;
    // Sale a unos hexes de un lugar para que el camino dure más de un día.
    const place = w.truth.ids(PLACE)[0] as string;
    const hexes = (w.truth.get(PLACE, place as never)?.hexes ?? []) as number[];
    let from = hexes[0] as number;
    for (let i = 0; i < 4; i++) {
      from =
        (w.map.neighbors[from] ?? []).find(
          (n) => !hexes.includes(n) && hexPath(w.map, n, hexes[0] as number).length > i,
        ) ?? from;
    }
    w.truth.set(LOCATION, npc, { hex: from });
    w.truth.set(NPC_DECISION, npc, {
      at: life.now,
      id: `move:${place}+toward:agent:99`,
      verb: "move",
      target: place,
      utility: 1,
      options: 2,
    } as never);
    const t0 = life.now;
    life.advanceTo(t0 + 4 * 86_400);
    const rests = w.log.all().filter((e) => e.kind === "action.rest" && e.actors[0] === npc);
    expect(rests.length).toBeGreaterThan(0);
    // Cada parada empieza en las horas de sueño y no hay dos en la misma noche.
    for (const e of rests) {
      const hour = Math.floor(localHour(w.clock, e.tick, w.map.lonDeg));
      expect(hour >= ROUTINE.sleep || hour < ROUTINE.wake).toBe(true);
    }
    for (let i = 1; i < rests.length; i++) {
      expect((rests[i]?.tick ?? 0) - (rests[i - 1]?.tick ?? 0)).toBeGreaterThanOrEqual(
        REST_GAP_HOURS * 3600,
      );
    }
    const trip = w.log
      .all()
      .filter((e) => e.kind === "npc.journey" && e.actors[0] === npc)
      .map((e) => (e.data as { what: string }).what);
    expect(trip[0]).toBe("started");
    // El ritmo `fast` del viaje llega al `move` (modo del verbo, con su tirada y su ruido).
    const first = w.log.all().find((e) => e.kind === "action.move" && e.actors[0] === npc);
    expect((first?.data as { manner?: string[] } | undefined)?.manner).toContain("fast");
  }, 240_000);
});
