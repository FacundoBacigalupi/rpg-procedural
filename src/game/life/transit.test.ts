import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, loadContent } from "../../core/index.ts";
import { hexPath, LOCATION, nearestHex, PERSON, PLACE } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { NPC_DECISION } from "./decide.ts";
import { Life } from "./life.ts";
import { positionAlong, walkSeconds } from "./transit.ts";
import { living } from "./world.ts";

const map = { crossSeconds: [0, 100, 200, 300, 400] };

describe("positionAlong", () => {
  it("está en el último hex cuyo cruce completó; sin completar el primero, sigue en la salida", () => {
    expect(walkSeconds(map, [1, 2, 3])).toBe(600);
    expect(positionAlong(map, 0, [1, 2, 3], 0)).toBe(0);
    expect(positionAlong(map, 0, [1, 2, 3], 99)).toBe(0);
    expect(positionAlong(map, 0, [1, 2, 3], 100)).toBe(1);
    expect(positionAlong(map, 0, [1, 2, 3], 299)).toBe(1);
    expect(positionAlong(map, 0, [1, 2, 3], 300)).toBe(2);
    expect(positionAlong(map, 0, [1, 2, 3], 9999)).toBe(3);
    expect(positionAlong(map, 5, [], 100)).toBe(5);
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
const HOUR = 3600;

describe("life.transit: el cuerpo en el camino (opt-in)", () => {
  function trip(npcTransit: boolean) {
    const life = Life.create(7, content, {
      npcVerbs: ["move"],
      npcJourneyDays: 6,
      ...(npcTransit ? { npcTransit: true } : {}),
    });
    const w = life.world;
    const npc = living(w.truth).find(
      (x) =>
        x !== life.player && (w.truth.get(PERSON, x)?.born ?? 0) < life.now - 20 * 365 * 86_400,
    ) as AgentId;
    // Sale a cuatro hexes de un lugar: hay hexes de por medio y llega en unas horas.
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
    const to = nearestHex(w.map, from, hexes);
    expect(hexPath(w.map, from, to).length).toBeGreaterThan(1);
    w.truth.set(NPC_DECISION, npc, {
      at: life.now,
      id: `move:${place}+toward:agent:99`,
      verb: "move",
      target: place,
      utility: 1,
      options: 2,
    } as never);
    const seen: number[] = [];
    for (let h = 0; h < 24; h++) {
      life.advanceTo(life.now + HOUR);
      seen.push(w.truth.get(LOCATION, npc)?.hex ?? -1);
    }
    return { w, from, to, seen };
  }

  it("encendido, el tramo cuesta su tiempo en el hex de salida; apagado, el cuerpo ya está en el fin del tramo", () => {
    const off = trip(false);
    // Sin tránsito `life.act` fija el fin del primer tramo al empezar.
    const offAt = off.seen.findIndex((h) => h !== off.from);
    const legEnd = off.seen[offAt] as number;
    expect(offAt).toBeGreaterThanOrEqual(0);

    const on = trip(true);
    const hours = walkSeconds(on.w.map, hexPath(on.w.map, on.from, legEnd)) / HOUR;
    expect(hours).toBeGreaterThan(2);
    // Mientras camina el tramo sigue donde salió y recién después aparece en el fin del tramo.
    const onAt = on.seen.findIndex((h) => h !== on.from);
    expect(on.seen[onAt]).toBe(legEnd);
    expect(onAt - offAt).toBeGreaterThanOrEqual(Math.floor(hours) - 1);
  }, 240_000);
});
