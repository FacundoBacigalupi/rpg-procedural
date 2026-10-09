import { describe, expect, it } from "vitest";
import { lookAcuity } from "./looking.ts";

describe("mirar a propósito", () => {
  it("solo el efecto observe cuenta como mirar, con su agudeza", () => {
    expect(lookAcuity({ effect: { kind: "observe", acuity: 0.7 } })).toBe(0.7);
    expect(lookAcuity({ effect: { kind: "observe" } })).toBe(0);
    expect(lookAcuity({ effect: { kind: "eat" } })).toBeUndefined();
    expect(lookAcuity(null)).toBeUndefined();
  });
});
