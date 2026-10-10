import { describe, expect, it } from "vitest";
import { clearDebts, type DebtEdge } from "./contagion.ts";

const e = (debtor: string, creditor: string, owed: number): DebtEdge => ({
  debtor,
  creditor,
  owed,
  commitment: `${debtor}>${creditor}`,
});

describe("contagio de quiebras", () => {
  it("una cadena cae en cascada: la quiebra del primero hunde al que contaba con cobrarle", () => {
    // a debe 100 a b, b debe 100 a c; a tiene 0, b tiene 10, c tiene 0.
    const out = clearDebts([e("a", "b", 100), e("b", "c", 100)], new Map([["b", 10]]));
    expect(out.round.get("a")).toBe(0);
    expect(out.round.get("b")).toBe(1);
    expect(out.because.get("b")).toEqual(["a"]);
    expect(out.payRatio.get("b")).toBeCloseTo(0.1);
    expect(out.failed).toEqual(["a", "b"]);
  });

  it("si cobra lo suficiente no cae, y se conserva el total", () => {
    const edges = [e("a", "b", 50), e("b", "c", 100)];
    const out = clearDebts(
      edges,
      new Map([
        ["a", 50],
        ["b", 50],
      ]),
    );
    expect(out.failed).toEqual([]);
    let eq = 0;
    for (const v of out.equity.values()) eq += v;
    expect(eq).toBeCloseTo(100);
  });
});
