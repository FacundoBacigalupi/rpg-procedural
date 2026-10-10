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
});
