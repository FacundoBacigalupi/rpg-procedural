import { describe, expect, it } from "vitest";
import { makeId, parseId } from "../../core/index.ts";
import { openSpace, type SpaceGraph, spaceReach, withOpenSpaces } from "./spaces.ts";
import { table, WorldTruth } from "./truth.ts";

const rows = table<{ n: number }>("test.memo");

function graph(): SpaceGraph {
  const mk = (key: string, hex: number, clearSight = 1) => ({
    ...openSpace(hex, false),
    key,
    clearSight,
  });
  return {
    spaces: [mk("a", 1), mk("b", 1, 0.5), mk("c", 1)],
    edges: [
      { a: "a", b: "b", barrier: "open" },
      { a: "b", b: "c", barrier: "open" },
    ],
  };
}

describe("memoizaciones puras", () => {
  it("spaceReach repetido da lo mismo que el primer cálculo y no cruza grafos", () => {
    const g = graph();
    const first = spaceReach(g, "a", "c", "sight");
    expect(spaceReach(g, "a", "c", "sight")).toEqual(first);
    const other = { spaces: g.spaces, edges: [] };
    expect(spaceReach(other, "a", "c", "sight").pass).toBe(0);
    expect(spaceReach(g, "a", "c", "sight")).toEqual(first);
  });

  it("withOpenSpaces con los mismos hexes devuelve el mismo grafo", () => {
    const g = graph();
    const a = withOpenSpaces(g, [{ hex: 7, forest: true }]);
    const b = withOpenSpaces(g, [{ hex: 7, forest: true }]);
    expect(b).toEqual(a);
    expect(withOpenSpaces(g, [{ hex: 7, forest: false }]).spaces).not.toEqual(a.spaces);
  });

  it("parseId memoizado conserva ids válidos e inválidos", () => {
    expect(parseId("agent:12")).toEqual({ kind: "agent", n: 12 });
    expect(parseId("agent:012")).toBeUndefined();
    expect(parseId("agent:12")).toEqual({ kind: "agent", n: 12 });
    expect(parseId("nope")).toBeUndefined();
  });

  it("WorldTruth.ids se invalida al agregar y quitar, y devuelve copias", () => {
    const t = new WorldTruth();
    const [a, b, c] = [1, 2, 3].map((n) => makeId("agent", n));
    t.set(rows, b as never, { n: 2 });
    t.set(rows, a as never, { n: 1 });
    const v = t.version;
    expect(t.ids(rows)).toEqual([a, b]);
    t.ids(rows).pop();
    expect(t.ids(rows)).toEqual([a, b]);
    t.set(rows, c as never, { n: 3 });
    expect(t.ids(rows)).toEqual([a, b, c]);
    t.deleteRaw(rows.name, a as never);
    expect(t.ids(rows)).toEqual([b, c]);
    expect(t.version).toBeGreaterThan(v);
  });
});
