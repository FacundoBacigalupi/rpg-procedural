import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import { BELONGING, belongingProblems } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { BELONGING_SEEDED_EVENT, BELONGING_STARTED_EVENT } from "./belonging.ts";
import { Life } from "./life.ts";

const DAY = 86400;

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}

// Hash de develop (el mismo de stages.test.ts): apagado no debe moverlo.
const BASE_HASH = "b218098c25ac14a61ca65cbd61b1324438ae2a400978faa2e6bfd7efa9b29f26";

describe("pertenencia (belonging)", () => {
  const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
  const run = (belonging: boolean, days: number) => {
    const l = Life.create(3, content, belonging ? { belonging: true } : {});
    l.advanceTo(l.now + DAY * days);
    return l;
  };
  const rows = (l: Life) => l.world.truth.ids(BELONGING);

  it("apagado deja el hash de develop, sin filas ni eventos", () => {
    const off = Life.create(3, content, {});
    expect(off.hash().total).toBe(BASE_HASH);
    expect(rows(off)).toEqual([]);
    expect(off.world.log.all().some((e) => e.kind === BELONGING_SEEDED_EVENT)).toBe(false);
  });

  it("encendido guarda una fila por persona viva, hija de la fundación y coherente", () => {
    const on = Life.create(3, content, { belonging: true });
    expect(on.hash().total).not.toBe(BASE_HASH);
    expect(rows(on).length).toBeGreaterThan(0);
    const seeded = on.world.log.all().filter((e) => e.kind === BELONGING_SEEDED_EVENT);
    expect(seeded).toHaveLength(1);
    expect(seeded[0]?.causes.length).toBeGreaterThan(0);
    for (const id of rows(on)) {
      const s = on.world.truth.get(BELONGING, id);
      expect(s?.originEventId).toBe(seeded[0]?.id);
      expect(s && belongingProblems(s)).toEqual([]);
    }
  });

  it("determinista; los avisos y los estados nuevos llevan causa", () => {
    const a = run(true, 60);
    const b = run(true, 60);
    expect(a.hash().total).toBe(b.hash().total);
    const kinds = new Set([
      "life.belonging-deficit",
      "life.belonging-restored",
      BELONGING_STARTED_EVENT,
    ]);
    for (const e of a.world.log.all().filter((x) => kinds.has(x.kind))) {
      expect(e.causes.length).toBeGreaterThan(0);
      expect(e.actors).toHaveLength(1);
    }
    for (const id of rows(a)) {
      const s = a.world.truth.get(BELONGING, id);
      expect(s && belongingProblems(s)).toEqual([]);
    }
  });
});
