import { describe, expect, it } from "vitest";
import {
  arrivalAppeal,
  chooseDestination,
  type Destination,
  decidesToLeave,
  leaveDesire,
} from "./famineMigration.ts";

describe("migración por hambruna", () => {
  it("sin empuje nadie se va; el arraigo y la falta de medios frenan", () => {
    expect(leaveDesire({ pull: 0, attachment: 0, means: 1 })).toBe(0);
    expect(decidesToLeave({ pull: 0, attachment: 0, means: 1 }, 0)).toBe(false);
    const free = leaveDesire({ pull: 0.5, attachment: 0, means: 1 });
    expect(leaveDesire({ pull: 0.5, attachment: 1, means: 1 })).toBeLessThan(free);
    expect(leaveDesire({ pull: 0.5, attachment: 0, means: 0 })).toBeLessThan(free);
  });

  it("elige el destino más atractivo, sin éxodo propio, y sin adónde ir se queda", () => {
    const good: Destination = { believedScarcity: 0, pull: 0, travelCost: 0.2, ties: 0.5 };
    const bad: Destination = { believedScarcity: 0.9, pull: 0.4, travelCost: 0.1, ties: 0 };
    expect(arrivalAppeal(good)).toBeGreaterThan(arrivalAppeal(bad));
    expect(
      chooseDestination(
        new Map([
          ["b", bad],
          ["a", good],
        ]),
      ),
    ).toBe("a");
    expect(chooseDestination(new Map([["b", bad]]))).toBeUndefined();
  });
});
