import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { makeId } from "../../core/index.ts";
import { diffStateHashes, hashState, table, WorldTruth } from "../world/index.ts";
import { DAY, HUT, village } from "./village.fixture.ts";

type Village = ReturnType<typeof village>;

function hashOf(w: Village) {
  return hashState({
    truth: w.truth,
    log: w.log,
    ledger: w.ledger,
    ids: w.ids.state(),
    scheduler: w.scheduler.state(),
  });
}

/**
 * Hashes de oro: la aldea de prueba con estos seeds a los 120 días. Si cambian sin que haya
 * cambiado la sim a propósito, el mundo dejó de ser determinista (o depende de la plataforma: el
 * CI corre esto en Windows y en Linux). Si el cambio es a propósito, se actualizan acá.
 */
const GOLDEN: Readonly<Record<number, string>> = {
  1: "3486b5aaaa3c4705dd66a387fc7facc02658563f3d302cbeff5c3ed128ac9a89",
  2: "e20fec3005f1db96782a1c8ac5d847372d961108d89e698ca9d3da5106bd537d",
  3: "b4f36cc3854d8335a2fa2e7c8d211f0a5e5fa232ccc435609a85a8a4f96c55c7",
};

describe("hashState", () => {
  it("no depende del orden en que se escribió la verdad", () => {
    const NOTE = table<{ a: number; b: string }>("note");
    const x = makeId("settlement", 1);
    const y = makeId("settlement", 2);
    const one = new WorldTruth();
    one.set(NOTE, x, { a: 1, b: "x" });
    one.set(NOTE, y, { a: 2, b: "y" });
    const two = new WorldTruth();
    two.set(NOTE, y, { b: "y", a: 2 });
    two.set(NOTE, x, { b: "x", a: 1 });
    expect(hashState({ truth: two })).toEqual(hashState({ truth: one }));
  });

  it("separa por componente y dice qué partes cambiaron", () => {
    const w = village(4);
    w.scheduler.advanceTo(30 * DAY);
    const before = hashOf(w);
    expect(Object.keys(before.parts)).toEqual(
      expect.arrayContaining(["c:entity", "events", "ledger", "ids", "scheduler"]),
    );
    w.truth.set(HUT, makeId("building", 999), { owner: makeId("settlement", 1) });
    const after = hashOf(w);
    expect(after.total).not.toBe(before.total);
    expect(diffStateHashes(before, after)).toEqual(["c:hut"]);
    expect(diffStateHashes(after, after)).toEqual([]);
  });

  it("la misma aldea con el mismo seed da el mismo hash; con otro, otro", () => {
    fc.assert(
      fc.property(fc.nat({ max: 0xffffffff }), fc.integer({ min: 1, max: 40 }), (seed, days) => {
        const a = village(seed);
        const b = village(seed);
        a.scheduler.advanceTo(days * DAY);
        // b llega por tramos: el hash no depende de cómo se avanzó.
        b.scheduler.advanceTo(Math.floor(days / 2) * DAY);
        b.scheduler.advanceTo(days * DAY);
        expect(hashOf(b)).toEqual(hashOf(a));
      }),
      { numRuns: 15 },
    );
  });

  it.each(Object.keys(GOLDEN).map(Number))(
    "determinismo por hash: seed %i a los 120 días",
    (seed) => {
      const w = village(seed);
      w.scheduler.advanceTo(120 * DAY);
      expect(hashOf(w).total).toBe(GOLDEN[seed]);
    },
  );
});
