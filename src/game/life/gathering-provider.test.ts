import { describe, expect, it } from "vitest";
import { Rng } from "../../core/index.ts";
import { WorldTruth } from "../../sim/index.ts";
import { extraGatherings, gatheringsFor } from "./gathering-provider.ts";

describe("gatheringsFor", () => {
  it("sin fiesta ni vendedores no arma reuniones", () => {
    const f = gatheringsFor({ clock: { day: 86400 } as never, rng: Rng.root(1 as never) });
    expect(f(new WorldTruth(), 0)).toEqual([]);
  });

  it("viajeros de paso y templo arman reuniones con sus ventanas", () => {
    const g = extraGatherings(
      [
        {
          place: "h|inn",
          open: false,
          visitors: new Map([
            ["a", { from: 18, to: 22 }],
            ["b", { from: 20, to: 24 }],
          ]),
        },
      ],
      [{ place: "h|temple", window: { from: 6, to: 8 }, attendees: ["z", "y"] }],
    );
    expect(g.map((x) => x.place)).toEqual(["h|inn", "h|temple"]);
    expect(g[1]?.open).toBe(false);
    const f = gatheringsFor({
      clock: { day: 86400 } as never,
      rng: Rng.root(1 as never),
      temple: () => [{ place: "h|t", window: { from: 6, to: 8 }, attendees: ["a", "b"] }],
    });
    expect(f(new WorldTruth(), 0)).toHaveLength(1);
  });
});
