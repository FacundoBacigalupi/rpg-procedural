import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { createLife, optInParts } from "./create.ts";

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

describe("opciones opt-in de la vida", () => {
  it("apagadas por defecto: no pasa nada al mundo", () => {
    expect(optInParts({})).toEqual({});
    expect(optInParts({ rumorGrievance: false })).toEqual({});
    expect(optInParts({ moldHintsFromCatalog: false })).toEqual({});
    expect(optInParts({ moldHintsFromCatalog: true })).toEqual({ moldHintsFromCatalog: true });
    expect(optInParts({ tradeView: false })).toEqual({});
    expect(optInParts({ tradeNeeds: { tool: 0.5 } })).toEqual({ tradeNeeds: { tool: 0.5 } });
  });

  it("la vista de oficios pasa misread y people a las partes", () => {
    const tv = { misread: { chance: 0.2 }, people: true };
    expect(optInParts({ tradeView: tv })).toEqual({ tradeView: tv });
    expect(optInParts({ tradeView: true })).toEqual({ tradeView: true });
  });

  it("encendidas llegan a las partes del mundo", () => {
    const off = createLife(7, content, { frequency: 8 }).world;
    const on = createLife(7, content, {
      frequency: 8,
      famine: { staple: "grain" },
      migration: { staple: "grain" },
      rumorGrievance: true,
    }).world;
    expect(off.famine).toBeUndefined();
    expect(off.migration).toBeUndefined();
    expect(off.rumorGrievance).toBeUndefined();
    expect(on.famine?.staple).toBe("grain");
    expect(on.migration?.staple).toBe("grain");
    expect(on.rumorGrievance).toBe(true);
  });

  it("waterSources llena hexKinds desde el terreno y relationDecay pasa a las partes", () => {
    expect(optInParts({ waterSources: {} }).waterSources).toEqual({});
    const terrain = { sea: [1, 0, 0], lake: [0, 1, 0], water: [0, 0, 2] } as never;
    const parts = optInParts({ waterSources: { open: "stagnant" }, relationDecay: true }, terrain);
    expect(parts.relationDecay).toBe(true);
    expect(parts.waterSources?.open).toBe("stagnant");
    expect([...(parts.waterSources?.hexKinds ?? [])]).toEqual([
      [0, "sea"],
      [1, "stagnant"],
      [2, "river"],
    ]);
    const given = new Map([[3, "sea" as const]]);
    expect(optInParts({ waterSources: { hexKinds: given } }, terrain).waterSources?.hexKinds).toBe(
      given,
    );
    const off = createLife(7, content, { frequency: 8 }).world;
    expect(off.waterSources).toBeUndefined();
    expect(off.relationDecay).toBeUndefined();
  });
});
