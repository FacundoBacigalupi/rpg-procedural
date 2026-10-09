import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, loadContent } from "../../core/index.ts";
import { ENTITY, PERSON, TASTES, TASTES_OF } from "../../sim/index.ts";
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
const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
const items = new Set(content.all(TASTES).map((t) => t.id));

describe("los gustos de la gente al empezar", () => {
  const w = Life.create(7, content).world;
  const alive = (w.truth.ids(PERSON) as AgentId[]).filter(
    (id) => w.truth.get(ENTITY, id)?.endedAt === undefined,
  );

  it("cada vivo tiene gustos con origen y de objetos del catálogo", () => {
    expect(alive.length).toBeGreaterThan(0);
    for (const id of alive) {
      const t = w.truth.get(TASTES_OF, id);
      expect(t, id).toBeDefined();
      expect(t?.preferences.length).toBeGreaterThan(0);
      for (const p of t?.preferences ?? []) {
        expect(items.has(p.item)).toBe(true);
        expect(p.originEventIds.length).toBeGreaterThan(0);
        expect(Math.abs(p.valence)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("no todos tienen los mismos gustos", () => {
    const sig = new Set(
      alive.map((id) =>
        (w.truth.get(TASTES_OF, id)?.preferences ?? [])
          .map((p) => `${p.item}:${Math.sign(p.valence)}`)
          .join(","),
      ),
    );
    expect(sig.size).toBeGreaterThan(1);
  });

  it("es determinista: mismo seed, mismos gustos", () => {
    fc.assert(
      fc.property(fc.nat(50), (seed) => {
        const a = Life.create(seed, content).world;
        const b = Life.create(seed, content).world;
        const ids = (a.truth.ids(PERSON) as AgentId[]).slice(0, 5);
        for (const id of ids) {
          expect(b.truth.get(TASTES_OF, id)).toEqual(a.truth.get(TASTES_OF, id));
        }
      }),
      { numRuns: 2 },
    );
  }, 120_000);
});
