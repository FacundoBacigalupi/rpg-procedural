import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, loadContent } from "../../core/index.ts";
import { LOCATION, PERSON, PLACE } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { NPC_DECISION } from "./decide.ts";
import { Life } from "./life.ts";
import { living } from "./world.ts";

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

/** Un adulto ajeno al personaje, un lugar de la aldea donde no está y la decisión de ir hacia él. */
function setup(seed: number, npcMove: boolean) {
  const life = Life.create(seed, content, npcMove ? { npcMove: true } : {});
  const w = life.world;
  const npc = living(w.truth).find(
    (id) =>
      id !== life.player && (w.truth.get(PERSON, id)?.born ?? 0) < life.now - 20 * 365 * 86_400,
  ) as AgentId;
  const place = w.truth
    .ids(PLACE)
    .find((id) => !w.truth.get(PLACE, id)?.hexes.includes(w.truth.get(LOCATION, npc)?.hex ?? -1));
  if (!place) throw new Error("sin lugar");
  const hexes = w.truth.get(PLACE, place)?.hexes ?? [];
  w.truth.set(NPC_DECISION, npc, {
    at: life.now,
    id: `move:${place}+toward:agent:99`,
    verb: "move",
    target: place,
    utility: 1,
    options: 2,
  } as never);
  return { life, w, npc, hexes };
}

const HOUR = 3600;

describe("NPC que ejecuta la decisión de ir hacia un lugar (opt-in)", () => {
  it("encendido, pasa el rato despierto en el lugar; apagado, la rutina manda", () => {
    const on = setup(7, true);
    const seen: number[] = [];
    for (let h = 0; h < 12; h++) {
      on.life.advanceTo(on.life.now + HOUR);
      const d = on.w.truth.get(NPC_DECISION, on.npc);
      if (d?.verb !== "move") break;
      seen.push(on.w.truth.get(LOCATION, on.npc)?.hex ?? -1);
    }
    expect(seen.some((hex) => on.hexes.includes(hex))).toBe(true);

    const off = setup(7, false);
    const offSeen: number[] = [];
    for (let h = 0; h < 12; h++) {
      off.life.advanceTo(off.life.now + HOUR);
      offSeen.push(off.w.truth.get(LOCATION, off.npc)?.hex ?? -1);
    }
    expect(offSeen.every((hex) => !off.hexes.includes(hex))).toBe(true);
  }, 120_000);
});
