import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import { DEVELOPMENT, LIFE_STAGES } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";
import { STAGE_ENTERED_EVENT, STAGES_SEEDED_EVENT, stageBoldness } from "./stages.ts";

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

// Hash de develop (el mismo de techknow.test.ts): apagado no debe moverlo.
const BASE_HASH = "b829bb7436cffc764da33660c899d578132ea796fdf7f86e47af651e5310c12f";

describe("etapas de vida (lifeStages)", () => {
  const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
  const run = (lifeStages: boolean, days: number) => {
    const l = Life.create(3, content, lifeStages ? { lifeStages: true } : {});
    l.advanceTo(l.now + DAY * days);
    return l;
  };
  const rows = (l: Life) => l.world.truth.ids(DEVELOPMENT);

  it("apagado deja el hash de develop, sin filas ni eventos", () => {
    const off = Life.create(3, content, {});
    expect(off.hash().total).toBe(BASE_HASH);
    expect(rows(off)).toEqual([]);
    expect(off.world.log.all().some((e) => e.kind === STAGES_SEEDED_EVENT)).toBe(false);
  });

  it("encendido guarda una fila por persona viva con la etapa de su edad, hijo de la fundación", () => {
    const on = Life.create(3, content, { lifeStages: true });
    expect(on.hash().total).not.toBe(BASE_HASH);
    expect(rows(on).length).toBeGreaterThan(0);
    const seeded = on.world.log.all().filter((e) => e.kind === STAGES_SEEDED_EVENT);
    expect(seeded).toHaveLength(1);
    expect(seeded[0]?.causes.length).toBeGreaterThan(0);
    const ids = new Set(content.all(LIFE_STAGES).map((s) => s.id));
    for (const id of rows(on)) {
      const d = on.world.truth.get(DEVELOPMENT, id);
      expect(ids.has(d?.stage ?? "")).toBe(true);
      expect(d?.originEventId).toBe(seeded[0]?.id);
    }
  });

  it("determinista y las etapas avanzan con evento y causa (cumpleaños)", () => {
    const a = run(true, 120);
    const b = run(true, 120);
    expect(a.hash().total).toBe(b.hash().total);
    const entered = a.world.log.all().filter((x) => x.kind === STAGE_ENTERED_EVENT);
    expect(entered.length).toBeGreaterThan(0);
    for (const e of entered) {
      expect(e.causes.length).toBeGreaterThan(0);
      expect(e.actors).toHaveLength(1);
    }
  });

  it("el sesgo de riesgo de la etapa mueve la audacia, acotada", () => {
    expect(stageBoldness(0.5, "adolescence")).toBeGreaterThan(stageBoldness(0.5, "elder"));
    expect(stageBoldness(1, "adolescence")).toBe(1);
    expect(stageBoldness(0, "elder")).toBe(0);
    expect(stageBoldness(0.5, "desconocida")).toBe(0.5);
  });
});
