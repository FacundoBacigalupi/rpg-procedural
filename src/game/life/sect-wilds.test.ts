// El monte de la sede (novel3-beasts-wilds): la celda de la sede tiene sus propias poblaciones, las
// que su clima sostiene, aparte del monte de la aldea; fijas por seed.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, type EntityRef, loadContent } from "../../core/index.ts";
import { ECOLOGY, LINEAGES, SECT, WILDS } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}

describe("el monte de la sede (novel3-beasts-wilds)", () => {
  const content = loadContent(GAME_CONTENT_KINDS, sources("content"));

  it("la sede tiene sus bestias por el clima de su celda, fijas por seed", () => {
    const wildsOf = () => {
      const life = Life.create(3, content, { cultivation: true, sectSeatRegion: true });
      const w = life.world;
      const org = w.truth.ids(SECT)[0] as EntityRef;
      const seat = w.truth.get(SECT, org)?.seatPlace as EntityRef;
      return { wilds: w.truth.get(WILDS, seat), ecologies: w.truth.ids(ECOLOGY).length };
    };
    const a = wildsOf();
    expect(a.ecologies).toBe(1);
    const wilds = a.wilds;
    if (!wilds) throw new Error("sin monte en la sede");
    const lineages = new Map(content.all(LINEAGES).map((d) => [d.id, d]));
    expect(wilds.populations.length).toBeGreaterThan(0);
    for (const p of wilds.populations) {
      expect(lineages.get(p.lineage)?.kingdom).not.toBe("plant");
      expect(p.count).toBeGreaterThan(0);
    }
    // Hay algún carnívoro que baja a las casas (el que tiene `raid`): sin eso no hay lobos.
    expect(wilds.populations.some((p) => lineages.get(p.lineage)?.raid !== undefined)).toBe(true);
    expect(wildsOf()).toEqual(a);
  }, 600_000);
});
