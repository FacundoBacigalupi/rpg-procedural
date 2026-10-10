import { describe, expect, it } from "vitest";
import { Rng } from "../../core/index.ts";
import { WorldTruth } from "../../sim/index.ts";
import { gatheringsFor } from "./gathering-provider.ts";

describe("gatheringsFor", () => {
  it("sin fiesta ni vendedores no arma reuniones", () => {
    const f = gatheringsFor({ clock: { day: 86400 } as never, rng: Rng.root(1 as never) });
    expect(f(new WorldTruth(), 0)).toEqual([]);
  });
});
