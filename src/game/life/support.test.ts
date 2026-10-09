import { describe, expect, it } from "vitest";
import { heaviestResponse, supportOf } from "./support.ts";

describe("supportOf", () => {
  it("el trauma se calma con compañía y la culpa con el rito", () => {
    expect(supportOf("trauma", 1, 0)).toBeGreaterThan(supportOf("trauma", 0, 1));
    expect(supportOf("guilt", 0, 1)).toBeGreaterThan(supportOf("guilt", 1, 0));
  });

  it("sin compañía ni rito no hay apoyo y nunca pasa de 1", () => {
    expect(supportOf("guilt", 0, 0)).toBe(0);
    expect(supportOf("trauma", 5, 5)).toBeLessThanOrEqual(1);
  });

  it("el rito alivia más a quien confiesa o repara que a quien desvía", () => {
    expect(supportOf("guilt", 0, 1, "confess")).toBeGreaterThan(
      supportOf("guilt", 0, 1, "deflect"),
    );
    expect(supportOf("trauma", 0, 1, "deflect")).toBe(supportOf("trauma", 0, 1, "confess"));
  });

  it("lo decidido sobre la culpa más pesada manda", () => {
    const stance = (response: "repair" | "deflect", guilt: number) => ({
      response,
      guilt,
      decided: 0,
    });
    expect(heaviestResponse(undefined)).toBe("none");
    expect(
      heaviestResponse({ byDeed: { a: stance("deflect", 0.2), b: stance("repair", 0.7) } }),
    ).toBe("repair");
  });
});
