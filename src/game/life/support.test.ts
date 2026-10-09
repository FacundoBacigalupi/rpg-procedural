import { describe, expect, it } from "vitest";
import { supportOf } from "./support.ts";

describe("supportOf", () => {
  it("el trauma se calma con compañía y la culpa con el rito", () => {
    expect(supportOf("trauma", 1, 0)).toBeGreaterThan(supportOf("trauma", 0, 1));
    expect(supportOf("guilt", 0, 1)).toBeGreaterThan(supportOf("guilt", 1, 0));
  });

  it("sin compañía ni rito no hay apoyo y nunca pasa de 1", () => {
    expect(supportOf("guilt", 0, 0)).toBe(0);
    expect(supportOf("trauma", 5, 5)).toBeLessThanOrEqual(1);
  });
});
