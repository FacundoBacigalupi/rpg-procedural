import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import { FOOD_CATEGORIES, FOODS, GOODS, MICRONUTRIENTS } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";

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
const foods = content.all(FOODS);
const goods = new Map(content.all(GOODS).map((g) => [g.id, g]));

describe("catálogo de alimentos", () => {
  it("cada alimento es un bien del ledger, con precio", () => {
    for (const f of foods) {
      const g = goods.get(f.id);
      expect(g, `${f.id} no tiene bien`).toBeDefined();
      expect(g?.form).toBe("good");
    }
  });

  it("cubre todas las categorías", () => {
    const seen = new Set(foods.map((f) => f.category));
    for (const c of FOOD_CATEGORIES) expect(seen.has(c), `sin ${c}`).toBe(true);
  });

  it("cada micronutriente se consigue en varios alimentos, para que su carencia salga de la dieta", () => {
    for (const n of Object.keys(MICRONUTRIENTS)) {
      const sources = foods.filter((f) => (f.micronutrients as Record<string, number>)[n]);
      expect(sources.length, n).toBeGreaterThanOrEqual(3);
    }
  });

  it("el escorbuto es evitable con la fruta de invierno y el pulido del arroz quita tiamina", () => {
    const by = (id: string) => foods.find((f) => f.id === id);
    expect(by("citrus")?.seasons).toContain("winter");
    const polished = by("rice-polished")?.micronutrients.thiamine ?? 0;
    const husked = by("rice-husked")?.micronutrients.thiamine ?? 0;
    expect(polished).toBeLessThan(husked / 3);
  });

  it("una dieta de solo arroz blanco falta de tiamina aunque sobren las calorías", () => {
    const rice = foods.find((f) => f.id === "rice-polished");
    if (!rice) throw new Error("falta el arroz");
    const grams = 2000 / rice.kcalPerGram;
    const mg = ((rice.micronutrients.thiamine ?? 0) * grams) / 100;
    expect(mg).toBeLessThan(MICRONUTRIENTS.thiamine.dailyMg / 2);
  });
});
