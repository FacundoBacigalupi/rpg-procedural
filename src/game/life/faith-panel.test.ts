import { describe, expect, it } from "vitest";
import { faithLevel } from "./panels.ts";

describe("la fe en el panel del personaje", () => {
  it("dice la fe con palabras, de menos a más, sin números", () => {
    expect(faithLevel(0)).toBe("none");
    expect(faithLevel(0.2)).toBe("faint");
    expect(faithLevel(0.5)).toBe("firm");
    expect(faithLevel(0.9)).toBe("deep");
  });
});
