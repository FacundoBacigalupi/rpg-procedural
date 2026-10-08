import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Rng } from "../../core/index.ts";
import {
  ACCENT_FEATURES,
  accentDistance,
  deriveAccent,
  identifyOrigin,
  judgeFake,
  perceiveAccent,
  rootAccent,
  spokenAccent,
  utterAccent,
} from "./accent.ts";

const seeds = fc.nat();
const unit = fc.double({ min: 0, max: 1, noNaN: true });

describe("acento como firma", () => {
  it("la deriva es determinista y deja los rasgos en 0-1", () => {
    fc.assert(
      fc.property(seeds, fc.integer({ min: 0, max: 40 }), (seed, gens) => {
        const mk = () =>
          deriveAccent(rootAccent(Rng.root(seed).fork("r")), Rng.root(seed).fork("d"), gens);
        const a = mk();
        expect(a).toEqual(mk());
        for (const f of ACCENT_FEATURES) {
          expect(a[f]).toBeGreaterThanOrEqual(0);
          expect(a[f]).toBeLessThanOrEqual(1);
        }
      }),
    );
  });

  it("separadas más generaciones, las variantes quedan en promedio más lejos", () => {
    let near = 0;
    let far = 0;
    for (let s = 0; s < 60; s++) {
      const root = rootAccent(Rng.root(s).fork("r"));
      near += accentDistance(root, deriveAccent(root, Rng.root(s).fork("n"), 1));
      far += accentDistance(root, deriveAccent(root, Rng.root(s).fork("f"), 25));
    }
    expect(far).toBeGreaterThan(near);
  });

  it("la distancia es simétrica y nula consigo misma", () => {
    fc.assert(
      fc.property(seeds, seeds, (a, b) => {
        const x = rootAccent(Rng.root(a));
        const y = rootAccent(Rng.root(b));
        expect(accentDistance(x, x)).toBe(0);
        expect(accentDistance(x, y)).toBeCloseTo(accentDistance(y, x), 12);
      }),
    );
  });

  it("imitar mejor acerca lo hablado al objetivo", () => {
    fc.assert(
      fc.property(seeds, seeds, unit, unit, (a, b, s1, s2) => {
        const native = rootAccent(Rng.root(a));
        const target = rootAccent(Rng.root(b));
        const lo = Math.min(s1, s2);
        const hi = Math.max(s1, s2);
        expect(accentDistance(spokenAccent(native, target, hi), target)).toBeLessThanOrEqual(
          accentDistance(spokenAccent(native, target, lo), target) + 1e-9,
        );
      }),
    );
    const n = rootAccent(Rng.root(1));
    const t = rootAccent(Rng.root(2));
    expect(spokenAccent(n, t, 0)).toEqual(n);
    expect(accentDistance(spokenAccent(n, t, 1), t)).toBeCloseTo(0, 12);
  });

  it("quien habla su propio acento no tiembla", () => {
    const n = rootAccent(Rng.root(3));
    expect(utterAccent(n, n, 0, 1, Rng.root(9))).toEqual(n);
  });

  it("un oído fino ubica mejor el origen que uno grueso", () => {
    const root = rootAccent(Rng.root(5).fork("r"));
    const known = ["a", "b", "c", "d", "e"].map((community, i) => ({
      community,
      accent: deriveAccent(root, Rng.root(5).fork("k", i), 6),
    }));
    const hits = (ear: number) => {
      let ok = 0;
      for (let t = 0; t < 300; t++) {
        const rng = Rng.root(t).fork("t");
        const k = known[t % known.length];
        if (!k) continue;
        const heard = utterAccent(k.accent, k.accent, 1, 0, rng);
        if (identifyOrigin(perceiveAccent(heard, ear, rng), known).nearest === k.community) ok++;
      }
      return ok;
    };
    expect(hits(1)).toBeGreaterThan(hits(0));
  });

  it("sin conocidos no hay origen que nombrar; lo ajeno es solo no ser de acá", () => {
    const x = rootAccent(Rng.root(7));
    expect(identifyOrigin(x, []).nearest).toBeUndefined();
    const far = Object.fromEntries(
      ACCENT_FEATURES.map((f) => [f, 1 - Math.round(x[f])]),
    ) as unknown as typeof x;
    const guess = identifyOrigin(x, [{ community: "c", accent: far }]);
    expect(guess.recognized).toBe(false);
  });

  it("el que finge mal levanta más sospecha que el que finge bien, y el nativo menos", () => {
    const native = rootAccent(Rng.root(11));
    const target = deriveAccent(native, Rng.root(12), 30);
    const mean = (own: typeof native, skill: number, ear: number) => {
      let s = 0;
      for (let t = 0; t < 200; t++) {
        const rng = Rng.root(t).fork("j");
        const heard = utterAccent(own, target, skill, 0.5, rng);
        s += judgeFake(heard, target, ear, rng).suspicion;
      }
      return s / 200;
    };
    expect(mean(native, 0, 0.8)).toBeGreaterThan(mean(native, 0.9, 0.8));
    expect(mean(target, 0, 0.8)).toBeLessThan(mean(native, 0, 0.8));
  });
});
