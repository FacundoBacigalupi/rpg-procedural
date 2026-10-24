import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, loadContent } from "../../core/index.ts";
import { checkInvariants, GARMENTS, PERSON, WorldTruth } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";
import { seasonalClothing } from "./thermal.ts";
import {
  GARMENT_WORN_OUT,
  garmentDayWear,
  WARDROBE,
  wardrobeClothing,
  wardrobeOf,
  wearDay,
} from "./wardrobe.ts";

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
      // Una vida nueva trae las prendas del contenido, no solo la que se retoma.
      expect(l.world.garments?.length).toBe(garments.length);
      l.advanceTo(l.now + 2 * DAY);
      return l.hash();
    };
    expect(run()).toEqual(run());
  }, 120_000);
});

describe("el desgaste de las prendas (clothing-wear)", () => {
  const basic = garments.filter((g) => g.basic).map((def) => ({ def, wear: 0 }));
  const byId = (id: string) => {
    const g = garments.find((x) => x.id === id);
    if (!g) throw new Error(id);
    return g;
  };

  it("con calor solo se gasta lo de abajo; con frío, también el abrigo", () => {
    const hot = wearDay(basic, 30, false, false).items;
    const cold = wearDay(basic, -3, false, false).items;
    const wear = (items: { garment: string; wear: number }[], id: string) =>
      items.find((i) => i.garment === id)?.wear ?? -1;
    expect(wear(hot, "undershirt")).toBeCloseTo(1 / byId("undershirt").wearDays, 5);
    expect(wear(hot, "quilted-coat")).toBe(0);
    expect(wear(cold, "quilted-coat")).toBeGreaterThan(0);
  });

  it("el trabajo gasta la ropa de abajo y el camino el calzado", () => {
    const shirt = byId("undershirt");
    const sandals = byId("straw-sandals");
    const coat = byId("quilted-coat");
    expect(garmentDayWear(shirt, true, false)).toBeGreaterThan(garmentDayWear(shirt, false, false));
    expect(garmentDayWear(coat, true, false)).toBe(garmentDayWear(coat, false, false));
    expect(garmentDayWear(sandals, false, true)).toBeGreaterThan(
      garmentDayWear(sandals, false, false),
    );
  });

  it("la que se deshace avisa una vez y no se pone más", () => {
    const sandals = byId("straw-sandals");
    const almost = basic.map((g) => (g.def.id === sandals.id ? { ...g, wear: 0.9999 } : g));
    const day = wearDay(almost, 25, false, false);
    expect(day.wornOut).toEqual([sandals.id]);
    const owned = day.items.map((i) => ({ def: byId(i.garment), wear: i.wear }));
    expect(wearDay(owned, 25, false, false).wornOut).toEqual([]);
    expect(owned.find((g) => g.def.id === sandals.id)?.wear).toBe(1);
  });

  it("en la vida cada uno gasta su ropa día a día, con auditoría e invariantes limpios", () => {
    const life = Life.create(7, content, { frequency: 8, wardrobe: true });
    const w = life.world;
    life.advanceTo(life.now + 3 * DAY);
    const people = w.truth.ids(PERSON).filter((id) => w.truth.get(WARDROBE, id as AgentId));
    expect(people.length).toBeGreaterThan(0);
    const row = w.truth.get(WARDROBE, people[0] as AgentId);
    const shirt = row?.items.find((i) => i.garment === "undershirt")?.wear ?? 0;
    expect(shirt).toBeGreaterThan(0);
    expect(shirt).toBeLessThan(0.05);
    expect(w.log.all().some((e) => e.kind === GARMENT_WORN_OUT)).toBe(false);
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  }, 300_000);
});
