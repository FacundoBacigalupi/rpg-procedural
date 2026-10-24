import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, loadContent } from "../../core/index.ts";
import { GARMENTS, WorldTruth } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";
import { seasonalClothing } from "./thermal.ts";
import { WARDROBE, wardrobeClothing, wardrobeOf } from "./wardrobe.ts";

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
const garments = content.all(GARMENTS);
const DAY = 86_400;

describe("el guardarropa (clothing-garments)", () => {
  const someone = "agent:1" as AgentId;

  it("sin fila tiene el juego básico entero, que alcanza para el invierno de la aldea", () => {
    const owned = wardrobeOf(new WorldTruth(), someone, garments);
    expect(owned.length).toBe(garments.filter((g) => g.basic).length);
    expect(owned.every((g) => g.wear === 0)).toBe(true);
    for (const airC of [30, 15, 0, -3]) {
      expect(wardrobeClothing(owned, airC).clo).toBeGreaterThanOrEqual(
        seasonalClothing(airC).clo - 1e-9,
      );
    }
  });

  it("con su fila tiene esas prendas; sin abrigo pasa frío", () => {
    const truth = new WorldTruth();
    truth.set(WARDROBE, someone, {
      items: [
        { garment: "undershirt", wear: 0 },
        { garment: "trousers", wear: 0.5 },
        { garment: "no-such-garment", wear: 0 },
      ],
    });
    const owned = wardrobeOf(truth, someone, garments);
    expect(owned.map((g) => g.def.id)).toEqual(["undershirt", "trousers"]);
    expect(wardrobeClothing(owned, -3).clo).toBeLessThan(seasonalClothing(-3).clo);
  });

  it("encendido en la vida corre y es determinista", () => {
    const run = () => {
      const l = Life.create(7, content, { frequency: 8, wardrobe: true });
      l.advanceTo(l.now + 2 * DAY);
      return l.hash();
    };
    expect(run()).toEqual(run());
  }, 120_000);
});
