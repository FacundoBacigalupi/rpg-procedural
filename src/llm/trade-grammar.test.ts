import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../core/index.ts";
import { GAME_CONTENT_KINDS } from "../game/index.ts";
import { Life } from "../game/life/index.ts";
import { parseCommand } from "./index.ts";

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
const catalog = Life.create(7, content).world.catalog;

describe("comerciar con cantidades", () => {
  it("separa lo que se trata de con quién", () => {
    const out = JSON.stringify(parseCommand("le vendo 2 kilos de grano a mi vecino", catalog));
    expect(out).toContain('"trade"');
    expect(out).toContain("2 kilos de grano");
    expect(out).toContain("vecino");
  });

  it("comprar sin cantidad nombra solo lo que se compra", () => {
    const out = JSON.stringify(parseCommand("compro grano con mi tío", catalog));
    expect(out).toContain('"what"');
    expect(out).toContain("grano");
    expect(out).toContain("tío");
  });

  it("comerciar sin más sigue siendo solo con quién", () => {
    const out = JSON.stringify(parseCommand("comercio con mi madre", catalog));
    expect(out).toContain('"with"');
    expect(out).not.toContain('"what"');
  });

  it("guardar lo que lleva en la despensa", () => {
    const out = JSON.stringify(parseCommand("guardo el grano en la despensa", catalog));
    expect(out).toContain('"store"');
    expect(out).toContain("el grano");
    expect(out).not.toContain("despensa");
    expect(JSON.stringify(parseCommand("guardo todo en la casa", catalog))).not.toContain('"what"');
  });
});
