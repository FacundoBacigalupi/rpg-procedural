import { describe, expect, it } from "vitest";
import { RECEIPT_WINDOW_DAYS, withReceipt } from "../../sim/index.ts";
import { neighborStandingKnown, noticeStanding } from "./neighbors.ts";

describe("life.neighbors", () => {
  it("el apuro o la ruina de un vecino queda anotado y se borra al verlo mejor", () => {
    const a = noticeStanding(undefined, "home:1", "broke", 10);
    expect(neighborStandingKnown(a, "home:1")).toEqual({ standing: "broke", day: 10 });
    expect(noticeStanding(a, "home:1", "comfortable", 12)?.homes).toEqual({});
    // Un vecino cómodo del que no se sabía nada no crea filas.
    expect(noticeStanding(undefined, "home:2", "comfortable", 10)).toBeUndefined();
  });

  it("las ventas se suman por día y salen de la ventana", () => {
    const r = withReceipt(withReceipt([], 5, 10, RECEIPT_WINDOW_DAYS), 5, 7, RECEIPT_WINDOW_DAYS);
    expect(r).toEqual([{ day: 5, coins: 17 }]);
    expect(withReceipt(r, 5 + RECEIPT_WINDOW_DAYS, 1, RECEIPT_WINDOW_DAYS)).toEqual([
      { day: 5 + RECEIPT_WINDOW_DAYS, coins: 1 },
    ]);
  });
});
