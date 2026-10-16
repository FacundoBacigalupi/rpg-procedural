import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  forumPenalty,
  forumResponse,
  forumThreshold,
  NO_STANDING,
  SANCTION_AT,
  SUMMON_AT,
} from "./forum.ts";
import { ACCUSATION_ACTS_AT } from "./testimony.ts";

const unit = fc.double({ min: 0, max: 1, noNaN: true });
const standing = fc.record({ authority: unit, loyalty: unit });
const RANK = { ignore: 0, mediate: 1, summon: 2, sanction: 3 } as const;

describe("el consejo como foro de la denuncia", () => {
  it("sin autoridad solo media, con alguna cita y con mucha sanciona", () => {
    expect(forumResponse(0.9, false, NO_STANDING)).toBe("mediate");
    expect(forumResponse(0.9, false, { authority: SUMMON_AT, loyalty: 0 })).toBe("summon");
    expect(forumResponse(0.9, false, { authority: SANCTION_AT, loyalty: 0 })).toBe("sanction");
  });

  it("la calumnia sospechada se ignora y lo poco creído no mueve al consejo", () => {
    expect(forumResponse(1, true, { authority: 1, loyalty: 0 })).toBe("ignore");
    expect(forumResponse(0.1, false, { authority: 1, loyalty: 0 })).toBe("ignore");
  });

  it("la lealtad del acusado sube el umbral (beneficio de la duda)", () => {
    expect(forumThreshold(NO_STANDING)).toBe(ACCUSATION_ACTS_AT);
    const between = ACCUSATION_ACTS_AT + 0.05;
    expect(forumResponse(between, false, { authority: 1, loyalty: 0 })).toBe("sanction");
    expect(forumResponse(between, false, { authority: 1, loyalty: 1 })).toBe("mediate");
  });

  it("más autoridad nunca baja la respuesta (monótona)", () => {
    fc.assert(
      fc.property(unit, fc.boolean(), unit, unit, unit, (b, liar, l, a1, a2) => {
        const [lo, hi] = a1 <= a2 ? [a1, a2] : [a2, a1];
        const r1 = forumResponse(b, liar, { authority: lo, loyalty: l });
        const r2 = forumResponse(b, liar, { authority: hi, loyalty: l });
        expect(RANK[r2]).toBeGreaterThanOrEqual(RANK[r1]);
      }),
    );
  });

  it("la pena que impone nunca pasa de la que merece y crece con autoridad y lealtad", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1.5, noNaN: true }), standing, (scale, s) => {
        const p = forumPenalty(scale, s);
        expect(p).toBeLessThanOrEqual(scale + 1e-12);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(forumPenalty(scale, { ...s, authority: 1 })).toBeGreaterThanOrEqual(p - 1e-12);
        expect(forumPenalty(scale, { ...s, loyalty: 1 })).toBeGreaterThanOrEqual(p - 1e-12);
      }),
    );
  });

  it("es determinista", () => {
    fc.assert(
      fc.property(unit, fc.boolean(), standing, (b, liar, s) => {
        expect(forumResponse(b, liar, s)).toBe(forumResponse(b, liar, s));
        expect(forumPenalty(b, s)).toBe(forumPenalty(b, s));
      }),
    );
  });
});
