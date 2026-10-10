import { describe, expect, it } from "vitest";
import { commitmentOwed } from "./commitment.ts";
import { forfeitPawn, openPawn, pawnOffer, pawnPhase, pawnTransfers, redeemPawn } from "./pawn.ts";

const open = () => {
  const r = openPawn({
    id: "commitment:1",
    pawner: "h:a",
    broker: "h:b",
    ref: "lot:1",
    unit: "coin",
    believedValue: 100,
    day: 10,
    originEventId: "e0",
    rate: 0.1,
  });
  if (!r) throw new Error("sin empeño");
  return r;
};

describe("empeño", () => {
  it("presta una fracción del valor creído y no abre sin valor", () => {
    expect(pawnOffer(100)).toEqual({ advance: 50, owed: 50 });
    expect(pawnOffer(0)).toBeNull();
    const r = open();
    expect(r.offer).toEqual({ advance: 50, owed: 55 });
    expect(commitmentOwed(r.commitment)).toBe(55);
    const t = pawnTransfers(
      { pawner: "h:a", broker: "h:b", unit: "coin" },
      { unit: "ring", amount: 1 },
      r.offer,
    );
    expect(t[0]).toMatchObject({ from: "h:a", to: "h:b", unit: "ring" });
    expect(t[1]).toMatchObject({ from: "h:b", to: "h:a", amount: 50 });
  });
  it("fases del plazo", () => {
    const c = open().commitment;
    expect(pawnPhase(c, 40)).toBe("open");
    expect(pawnPhase(c, 42)).toBe("grace");
    expect(pawnPhase(c, 44)).toBe("forfeit");
  });
  it("pagar todo devuelve la prenda; a medias no", () => {
    const c = open().commitment;
    const half = redeemPawn(c, 20);
    expect(half.redeemed).toBe(false);
    expect(commitmentOwed(half.commitment)).toBe(35);
    const full = redeemPawn(half.commitment, 999);
    expect(full.applied).toBe(35);
    expect(full.redeemed).toBe(true);
    expect(full.commitment.status).toBe("fulfilled");
  });
  it("vencido, el lote pasa a la casa como seize", () => {
    const out = forfeitPawn(open().commitment, 100, "lot:1");
    expect(out.taken).toBe(55);
    expect(out.commitment.status).toBe("fulfilled");
    expect(out.commitment.guarantees).toHaveLength(0);
  });
});
