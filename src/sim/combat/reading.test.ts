import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Rng } from "../../core/index.ts";
import { killAftermath } from "./aftermath.ts";
import {
  believedOdds,
  clarity,
  type Readable,
  readRival,
  resolveBreak,
  resolveFeint,
} from "./reading.ts";

const foe: Readable = { power: 0.7, breath: 0.5, hurt: 0.3, fear: 0.4 };
const eye = { sight: 1, skill: 0.9 };
const blind = { sight: 0.2, skill: 0.1 };

describe("leer al rival", () => {
  it("es determinista", () => {
    expect(readRival(eye, foe, 1, Rng.root(3))).toEqual(readRival(eye, foe, 1, Rng.root(3)));
  });

  it("con luz y ojo se acerca a la verdad; a oscuras y sin ojo se fía menos", () => {
    expect(clarity(eye, 1)).toBeGreaterThan(clarity(eye, 0.1));
    expect(clarity(eye, 1)).toBeGreaterThan(clarity(blind, 1));
    expect(readRival(eye, foe, 1, Rng.root(1)).spread).toBeLessThan(
      readRival(blind, foe, 0.2, Rng.root(1)).spread,
    );
  });

  it("quien esconde su nivel engaña al ojo flojo y no al entrenado", () => {
    const hider: Readable = { ...foe, hides: 1 };
    const soft = readRival(blind, hider, 1, Rng.root(5));
    const sharp = readRival(eye, hider, 1, Rng.root(5));
    expect(sharp.power).toBeGreaterThan(soft.power - 0.3);
    expect(readRival(eye, hider, 1, Rng.root(5)).power).toBeGreaterThan(0.4);
  });

  it("lee el vicio de bajar la guardia solo si ve claro", () => {
    const vice: Readable = { ...foe, streak: 2, dropsGuardAfter: 3 };
    let sharp = 0;
    let dull = 0;
    for (let i = 0; i < 200; i++) {
      if (readRival(eye, vice, 1, Rng.root(i)).guardDownSoon) sharp++;
      if (readRival(blind, vice, 1, Rng.root(i)).guardDownSoon) dull++;
    }
    expect(sharp).toBeGreaterThan(dull);
    expect(
      readRival(eye, { ...foe, streak: 0, dropsGuardAfter: 3 }, 1, Rng.root(1)).guardDownSoon,
    ).toBe(false);
  });
});

describe("fintas", () => {
  const buys = (skill: number, defender: Parameters<typeof resolveFeint>[1]) => {
    let n = 0;
    for (let i = 0; i < 300; i++) {
      if (resolveFeint({ skill }, defender, 1, Rng.root(i)).outcome === "bought") n++;
    }
    return n;
  };

  it("contra un ojo muy entrenado cuesta tiempo y no compra casi nada", () => {
    const trained = { sight: 1, skill: 1, alert: true, familiarity: 1 };
    const novice = { sight: 0.5, skill: 0, alert: true };
    expect(buys(0.5, trained)).toBeLessThan(buys(0.5, novice));
    const r = resolveFeint({ skill: 0.5 }, trained, 1, Rng.root(1));
    if (r.outcome === "read") {
      expect(r.cost).toBeGreaterThanOrEqual(1);
      expect(r.balanceLost).toBe(0);
      expect(r.opening).toBe(0);
    }
  });

  it("quien no está atento la compra casi siempre", () => {
    expect(buys(0, { sight: 1, skill: 1, alert: false })).toBeGreaterThan(270);
  });
});

describe("chances creídas y quiebre", () => {
  const read = readRival(eye, foe, 1, Rng.root(2));

  it("cada golpe que come baja las chances y cada uno que mete las sube", () => {
    const base = { myPower: 0.6, landed: 0, taken: 0 };
    expect(believedOdds(read, { ...base, taken: 3 }).myOdds).toBeLessThan(
      believedOdds(read, base).myOdds,
    );
    expect(believedOdds(read, { ...base, landed: 3 }).myOdds).toBeGreaterThan(
      believedOdds(read, base).myOdds,
    );
    expect(believedOdds(read, { ...base, alliesDown: 2 }).myOdds).toBeLessThan(
      believedOdds(read, base).myOdds,
    );
  });

  it("las chances siempre están entre 0 y 1", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.integer({ min: -20, max: 20 }),
        (p, d) => {
          const o = believedOdds(read, {
            myPower: p,
            landed: Math.max(0, d),
            taken: Math.max(0, -d),
          });
          expect(o.myOdds).toBeGreaterThanOrEqual(0);
          expect(o.myOdds).toBeLessThanOrEqual(1);
        },
      ),
    );
  });

  const input = (odds: number, over = {}) => ({
    belief: { myOdds: odds, spread: 0.1 },
    breakAt: 0.3,
    drivers: {},
    canRun: true,
    cornered: false,
    foeFaster: false,
    ...over,
  });

  it("sigue si cree ganar; se quiebra si no; la desesperación y la ira lo sostienen", () => {
    expect(resolveBreak(input(0.6), Rng.root(1)).kind).toBe("hold");
    expect(resolveBreak(input(0.2), Rng.root(1)).kind).toBe("flee");
    expect(
      resolveBreak(input(0.25, { drivers: { desperation: 1, anger: 1 } }), Rng.root(1)).kind,
    ).toBe("hold");
  });

  it("sin poder correr se rinde; acorralado y en pánico puede paralizarse", () => {
    expect(resolveBreak(input(0.1, { canRun: false }), Rng.root(1)).kind).toBe("yield");
    const kinds = new Set<string>();
    for (let i = 0; i < 100; i++) {
      kinds.add(resolveBreak(input(0.1, { cornered: true, panic: 1 }), Rng.root(i)).kind);
    }
    expect(kinds.has("freeze")).toBe(true);
    expect(kinds.has("flee")).toBe(false);
  });
});

describe("después de matar", () => {
  const facts = {
    defenseless: false,
    closeness: 0,
    selfDefense: true,
    condemned: 0,
    hadChoice: 0,
    gore: 0.5,
    priorKills: 0,
  };
  const who = { z: {}, schemas: {} };

  it("matar a quien ya no se defendía pesa más que en defensa propia", () => {
    const a = killAftermath(facts, who);
    const b = killAftermath({ ...facts, selfDefense: false, defenseless: true, hadChoice: 1 }, who);
    expect(b.guilt).toBeGreaterThan(a.guilt);
  });

  it("la costumbre embota y el apoyo alivia el trauma", () => {
    const first = killAftermath(facts, who);
    expect(killAftermath({ ...facts, priorKills: 5 }, who).trauma).toBeLessThan(first.trauma);
    expect(killAftermath(facts, { ...who, support: 1 }).trauma).toBeLessThan(first.trauma);
  });

  it("es determinista y acotada", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.integer({ min: 0, max: 30 }),
        (x, n) => {
          const f = { ...facts, closeness: x, gore: x, priorKills: n };
          const r = killAftermath(f, who);
          expect(killAftermath(f, who)).toEqual(r);
          for (const v of [r.guilt, r.trauma]) {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
          }
        },
      ),
    );
  });
});
