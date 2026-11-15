// El puesto de guardia hacia la otra secta (novel4-watch-need): el camino más corto por el mapa.

import { describe, expect, it } from "vitest";
import type { LocalMap } from "../../sim/index.ts";
import { watchPost } from "./sect-watch.ts";

/** Una fila de `n` hexes, cada uno vecino del anterior y del siguiente, más un atajo opcional. */
function line(n: number, extra: Record<number, number[]> = {}): LocalMap {
  const neighbors = Array.from({ length: n }, (_, i) => [
    ...(i > 0 ? [i - 1] : []),
    ...(i < n - 1 ? [i + 1] : []),
    ...(extra[i] ?? []),
  ]);
  return { neighbors } as unknown as LocalMap;
}

describe("el puesto en el camino (novel4-watch-need)", () => {
  it("a `radius` pasos de la sede propia, sin llegar a la otra", () => {
    expect(watchPost(line(10), 0, 9, 3)).toEqual({ hex: 3, distance: 3 });
    // Camino corto: el anterior a la otra sede.
    expect(watchPost(line(10), 0, 2, 3)).toEqual({ hex: 1, distance: 1 });
    // Pegadas: el puesto es la otra sede (no hay hex entre medio).
    expect(watchPost(line(10), 0, 1, 3)).toEqual({ hex: 1, distance: 1 });
  });

  it("toma el camino más corto; sin camino o en la misma sede, no hay puesto", () => {
    expect(watchPost(line(10, { 0: [7], 7: [0] }), 0, 9, 3)).toEqual({ hex: 8, distance: 2 });
    expect(watchPost(line(4), 0, 0, 3)).toBeUndefined();
    const apart = { neighbors: [[1], [0], [3], [2]] } as unknown as LocalMap;
    expect(watchPost(apart, 0, 3, 3)).toBeUndefined();
  });
});
