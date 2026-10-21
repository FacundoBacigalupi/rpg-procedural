import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
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
const BASE_HASH = "b829bb7436cffc764da33660c899d578132ea796fdf7f86e47af651e5310c12f";

describe("sesgo de apego en las relaciones (attachmentBias)", () => {
  const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
  const run = (opts: object, days: number) => {
    const l = Life.create(3, content, opts);
    l.advanceTo(l.now + DAY * days);
    return l;
  };

  it("sin lifeStages no hace nada: el hash es el de develop", () => {
    expect(Life.create(3, content, { attachmentBias: true }).hash().total).toBe(BASE_HASH);
  }, 600_000);

  it("encendido es determinista y mueve las relaciones respecto de solo lifeStages", () => {
    const a = run({ lifeStages: true, attachmentBias: true }, 40);
    const b = run({ lifeStages: true, attachmentBias: true }, 40);
    const plain = run({ lifeStages: true }, 40);
    expect(a.hash().total).toBe(b.hash().total);
    expect(a.hash().total).not.toBe(plain.hash().total);
  }, 600_000);
});
