import { describe, expect, it } from "vitest";
import { type ErrandPlace, errandCandidates } from "./errands.ts";

const o = { kinds: ["fields", "water"], chance: 0.5, weight: 0.4 };
const places: ErrandPlace[] = [
  { id: "place:1", kind: "village", hexes: [3] },
  { id: "place:2", kind: "fields", hexes: [3, 4] },
  { id: "place:3", kind: "fields", hexes: [7] },
  { id: "place:4", kind: "forest", hexes: [9] },
  { id: "place:5", kind: "water", hexes: [8] },
];

describe("errandCandidates", () => {
  it("no propone nada si la tirada no alcanza la chance", () => {
    expect(errandCandidates(places, 3, o, 0.5, 0)).toEqual([]);
  });

  it("elige solo entre lugares del tipo pedido que no contienen su hex", () => {
    const ids = [0, 0.4, 0.99].flatMap((pick) =>
      errandCandidates(places, 3, o, 0, pick).map((c) => c.target),
    );
    expect(ids).toEqual(["place:3", "place:3", "place:5"]);
  });

  it("es una candidata move con ánimo y es determinista", () => {
    const a = errandCandidates(places, 3, o, 0.1, 0.7);
    expect(a).toEqual(errandCandidates(places, 3, o, 0.1, 0.7));
    expect(a[0]).toMatchObject({ verb: "move", id: "move:place:5", mood: 0.4 });
  });

  it("sin lugares lejanos no propone", () => {
    expect(errandCandidates([places[1] as ErrandPlace], 3, o, 0, 0)).toEqual([]);
  });
});
