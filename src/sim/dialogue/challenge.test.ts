import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Rng } from "../../core/index.ts";
import { normalize, understand } from "./acts.ts";
import {
  type ChallengeInput,
  challenges,
  DUEL_RULES,
  duelFace,
  duelRuleIn,
  refuseFace,
  weighChallenge,
} from "./challenge.ts";

const base: ChallengeInput = {
  rule: "yield",
  myOdds: 0.5,
  pride: 0.5,
  courage: 0.5,
  witnesses: 0,
  rankGap: 0,
  grudge: 0,
};

const lex = { people: [], goods: [] } as unknown as Parameters<typeof understand>[1];

describe("desafíos (novel3-challenge-core)", () => {
  it("la gramática reconoce el desafío y su regla; «te reto» suelto es rezongar", () => {
    const cases: [string, string][] = [
      ["Te desafío", "yield"],
      ["Te reto a un duelo", "yield"],
      ["Te reto a pelear hasta que uno se rinda", "yield"],
      ["Te reto a duelo a muerte", "death"],
      ["Te desafío a la plataforma de vida o muerte", "death"],
      ["Te reto a duelo, a primera sangre", "first_blood"],
    ];
    for (const [text, rule] of cases) {
      const act = understand(text, lex);
      expect(act, normalize(text)).toMatchObject({ kind: "challenge", rule });
    }
    expect(challenges(normalize("Te reto por llegar tarde"))).toBe(false);
    expect(understand("Te mato", lex).kind).toBe("threaten");
    expect(duelRuleIn("te reto")).toBe("yield");
  });

  it("quien cree ganar acepta; quien cree perder a muerte rechaza", () => {
    expect(weighChallenge({ ...base, myOdds: 0.9 }, Rng.root(1)).response).toBe("accept");
    expect(
      weighChallenge({ ...base, myOdds: 0.1, rule: "death", courage: 0.2 }, Rng.root(2)).response,
    ).toBe("refuse");
  });

  it("los testigos y el orgullo empujan a aceptar lo que a solas se rechaza", () => {
    const alone = { ...base, myOdds: 0.3, pride: 0.9 };
    expect(weighChallenge(alone, Rng.root(3)).response).toBe("refuse");
    expect(weighChallenge({ ...alone, witnesses: 4 }, Rng.root(3)).response).toBe("accept");
  });

  it("rechazar cuesta cara solo en público; menos a muerte y menos al mayor", () => {
    expect(refuseFace({ ...base, witnesses: 0 })).toBe(0);
    const pub = refuseFace({ ...base, witnesses: 3 });
    expect(pub).toBeGreaterThan(0);
    expect(refuseFace({ ...base, witnesses: 3, rule: "death" })).toBeLessThan(pub);
    expect(refuseFace({ ...base, witnesses: 3, rankGap: 1 })).toBeLessThan(pub);
  });

  it("el resultado mueve más la cara con testigos, a muerte y contra uno de arriba", () => {
    const plain = duelFace("yield", 0, 0).win;
    expect(plain).toBeGreaterThan(0);
    expect(duelFace("yield", 3, 0).win).toBeGreaterThan(plain);
    expect(duelFace("death", 0, 0).win).toBeGreaterThan(plain);
    expect(duelFace("yield", 0, 1).win).toBeGreaterThan(plain);
  });

  it("acotado y determinista", () => {
    fc.assert(
      fc.property(
        fc.record({
          rule: fc.constantFrom(...DUEL_RULES),
          myOdds: fc.double({ min: -1, max: 2, noNaN: true }),
          pride: fc.double({ min: 0, max: 1, noNaN: true }),
          courage: fc.double({ min: 0, max: 1, noNaN: true }),
          witnesses: fc.integer({ min: 0, max: 20 }),
          rankGap: fc.integer({ min: -4, max: 4 }),
          grudge: fc.double({ min: 0, max: 1, noNaN: true }),
        }),
        fc.integer({ min: 0, max: 1000 }),
        (i, seed) => {
          const a = weighChallenge(i, Rng.root(seed));
          expect(weighChallenge(i, Rng.root(seed))).toEqual(a);
          expect(a.refuseFace).toBeGreaterThanOrEqual(0);
          expect(a.refuseFace).toBeLessThanOrEqual(1);
          const f = duelFace(i.rule, i.witnesses, i.rankGap);
          expect(f.win).toBeGreaterThan(0);
          expect(f.win).toBeLessThanOrEqual(1);
        },
      ),
    );
  });
});
