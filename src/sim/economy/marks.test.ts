import { describe, expect, it } from "vitest";
import { forgeMark, forgeryDetectChance, isForged, stampMark, verifyMark } from "./index.ts";

const a = "agent:1" as never;
const b = "agent:2" as never;
const t = 5 as never;

describe("marcas de lote", () => {
  it("la auténtica no se detecta como falsa y la falsa mejor hecha se detecta menos", () => {
    const m = stampMark(a, 0.8, t);
    expect(isForged(m)).toBe(false);
    expect(forgeryDetectChance(m.fidelity, 1, 1)).toBe(0);
    const bad = forgeMark(m, b, t, 0.2, 0.1);
    const good = forgeMark(m, b, t, 0.9, 1);
    expect(isForged(good)).toBe(true);
    expect(good.fidelity).toBeGreaterThan(bad.fidelity);
    expect(forgeryDetectChance(good.fidelity, 0.5, 0.5)).toBeLessThan(
      forgeryDetectChance(bad.fidelity, 0.5, 0.5),
    );
  });
  it("el ojo familiarizado la caza y entonces no le cree", () => {
    const f = forgeMark(stampMark(a, 0.8, t), b, t, 0.5, 0.5);
    expect(verifyMark(f, 1, 1, 0.9, 0).seemsForged).toBe(true);
    expect(verifyMark(f, 1, 1, 0.9, 0).credence).toBe(0);
    expect(verifyMark(f, 0, 0, 0.9, 0.99).credence).toBeGreaterThan(0.5);
  });
});
