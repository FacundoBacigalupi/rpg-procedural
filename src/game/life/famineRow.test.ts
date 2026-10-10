import { describe, expect, it } from "vitest";
import { BUILDING, PERSON, WorldTruth } from "../../sim/index.ts";
import { FAMINE, pricePushOf } from "./famineRow.ts";

function world(): WorldTruth {
  const t = new WorldTruth();
  t.set(PERSON, "p1" as never, { household: "h1" } as never);
  t.set(BUILDING, "b1" as never, { household: "h1", settlement: "s1" } as never);
  return t;
}

describe("empuje de precio de la hambruna en el trato", () => {
  it("sin filas de FAMINE o sin escasez no hay empuje", () => {
    const t = world();
    expect(pricePushOf(t, "p1")).toBe(1);
    t.set(FAMINE, "s1" as never, {
      state: "none",
      value: 0,
      since: 0,
      pricePush: 1,
      migrationPull: 0,
    });
    expect(pricePushOf(t, "p1")).toBe(1);
  });

  it("con escasez en el asentamiento del hogar devuelve su pricePush", () => {
    const t = world();
    t.set(FAMINE, "s1" as never, {
      state: "famine",
      value: 0.9,
      since: 3,
      pricePush: 2.2,
      migrationPull: 0.3,
    });
    expect(pricePushOf(t, "p1")).toBe(2.2);
    expect(pricePushOf(t, "nadie")).toBe(1);
  });
});
