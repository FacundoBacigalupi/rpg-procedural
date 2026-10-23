import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import type { Percept } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";
import { playerView, presenceKey } from "./view.ts";

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

describe("quienes ya se contaron no se repiten (quietPresence)", () => {
  it("los presentes quietos salen de la escena, pero onSeen los sigue dando", () => {
    const w = Life.create(7, content, { frequency: 8 }).world;
    let seen: readonly Percept[] = [];
    const first = playerView(w, [], { onSeen: (p) => (seen = p) });
    expect(seen.length).toBeGreaterThan(0);
    const keys = new Set(seen.map(presenceKey));
    let again: readonly Percept[] = [];
    const second = playerView(w, [], { quietPresence: keys, onSeen: (p) => (again = p) });
    expect(again).toEqual(seen);
    const quiet = seen.filter((p) => p.fields.action === undefined && p.fields.words === undefined);
    expect(second.percepts.length).toBe(first.percepts.length - quiet.length);
  });

  it("mirar a propósito y la primera escena cuentan a todos igual", () => {
    const w = Life.create(7, content, { frequency: 8 }).world;
    let seen: readonly Percept[] = [];
    const intro = playerView(w, [], { intro: true, onSeen: (p) => (seen = p) });
    const keys = new Set(seen.map(presenceKey));
    const introAgain = playerView(w, [], { intro: true, quietPresence: keys });
    expect(introAgain.percepts).toEqual(intro.percepts);
  });
});
