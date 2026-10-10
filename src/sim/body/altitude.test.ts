import { describe, expect, it } from "vitest";
import {
  altitudeEnduranceFactor,
  altitudeSickness,
  hypoxia,
  stepAcclimatization,
} from "./altitude.ts";

describe("mal de altura y aclimatación", () => {
  it("en el llano no hay efecto", () => {
    expect(hypoxia(0)).toBe(0);
    expect(altitudeEnduranceFactor(300, 0)).toBe(1);
    expect(altitudeSickness(300, 0)).toBe("none");
  });

  it("más altura, menos resistencia; la aclimatación la devuelve en parte", () => {
    const a = altitudeEnduranceFactor(3000, 0);
    const b = altitudeEnduranceFactor(6000, 0);
    expect(a).toBeLessThan(1);
    expect(b).toBeLessThan(a);
    expect(altitudeEnduranceFactor(6000, 1)).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(0);
    expect(altitudeSickness(6000, 0)).toBe("severe");
    expect(altitudeSickness(6000, 1)).not.toBe("severe");
  });

  it("los días en altura suben la aclimatación y en el llano bajan, más despacio", () => {
    const up = stepAcclimatization(0, 4000, 10);
    expect(up).toBeGreaterThan(0);
    expect(stepAcclimatization(up, 4000, 100)).toBeLessThanOrEqual(hypoxia(4000));
    const down = stepAcclimatization(up, 0, 5);
    expect(down).toBeLessThan(up);
    expect(up - down).toBeLessThan(up - 0);
    expect(stepAcclimatization(0, 0, 50)).toBe(0);
  });
});
