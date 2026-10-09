import { describe, expect, it } from "vitest";
import {
  BULK_DISCOUNT,
  BULK_GRAMS,
  BULK_SPARE,
  PITCH_GRAMS,
  PITCH_MARGIN,
  pitchLot,
} from "./pitch.ts";

describe("lote de la oferta del vecino", () => {
  it("con poco de sobra ofrece el lote chico; con mucho, uno al por mayor más barato", () => {
    expect(pitchLot(PITCH_GRAMS)).toEqual({ grams: PITCH_GRAMS, margin: PITCH_MARGIN });
    expect(pitchLot(BULK_SPARE - 1).grams).toBe(PITCH_GRAMS);
    const bulk = pitchLot(BULK_SPARE);
    expect(bulk.grams).toBe(BULK_GRAMS);
    expect(bulk.margin).toBeCloseTo(PITCH_MARGIN - BULK_DISCOUNT);
    expect(bulk.margin).toBeLessThan(PITCH_MARGIN);
  });
});
