import { describe, expect, it } from "vitest";
import { makeId } from "../../core/index.ts";
import { resolveTastes, TasteSpec } from "./chosen.ts";

const catalog = new Map([
  ["food.flavor", new Set(["bitter", "spicy", "sweet"])],
  ["pastime", new Set(["go", "flute"])],
]);
const origin = makeId("event", 7);
const spec = (o: object) =>
  TasteSpec.parse({ domain: "food.flavor", item: "bitter", valence: 0.8, ...o });

describe("gustos elegidos", () => {
  it("fija con origen y marca lo adquirido", () => {
    const r = resolveTastes(
      [spec({ because: "childhood" }), spec({ item: "sweet", valence: -0.5 })],
      catalog,
      origin,
    );
    expect(r.rejected).toEqual([]);
    expect(r.tastes[0]).toMatchObject({
      acquired: true,
      source: "chosen",
      originEventIds: [origin],
    });
    expect(r.tastes[1]?.acquired).toBe(false);
  });

  it("rechaza lo desconocido y las contradicciones; funde lo repetido", () => {
    const r = resolveTastes(
      [
        spec({}),
        spec({ valence: -0.4 }),
        spec({ domain: "color" }),
        spec({ item: "salty" }),
        spec({ strength: 0.9 }),
      ],
      catalog,
      origin,
    );
    expect(r.rejected.map((x) => x.index)).toEqual([1, 2, 3]);
    expect(r.tastes).toHaveLength(1);
    expect(r.tastes[0]?.strength).toBe(0.9);
  });

  it("es determinista", () => {
    const s = [spec({}), spec({ domain: "pastime", item: "go" })];
    expect(resolveTastes(s, catalog, origin)).toEqual(resolveTastes(s, catalog, origin));
  });
});
