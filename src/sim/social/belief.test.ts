import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type AgentId, type EventId, Rng } from "../../core/index.ts";
import { beliefAbout, rankOfAttire, readStanding, updateBeliefs } from "./belief.ts";
import {
  adjustFace,
  type EtiquetteNorm,
  exposureOffense,
  faceLoss,
  judgeBreach,
  respondToOffense,
} from "./etiquette.ts";
import type { StatusDef } from "./status.ts";

const mk = (id: string, rank: number, attire: StatusDef["attire"]): StatusDef => ({
  id,
  name: id,
  culture: "village",
  role: rank === 2 ? "holder" : rank === 1 ? "common" : "dependent",
  rank,
  wealth: 1,
  attire,
});
const defs = [mk("landholder", 2, "fine"), mk("peasant", 1, "plain"), mk("servant", 0, "worn")];
const ev = "event:1" as EventId;
const a = "agent:1" as AgentId;
const norm: EtiquetteNorm = {
  id: "n",
  name: "n",
  culture: "village",
  act: "address",
  owedBy: "lower",
  minGap: 1,
  severity: 0.3,
};

describe("creencias sobre la posición ajena", () => {
  it("quien se conoce de antes se lee por su rango verdadero", () => {
    const r = readStanding({ acquainted: true, clarity: 0.1 }, 2, defs, Rng.root(1).fork("a"));
    expect(r).toEqual({ rank: 2, confidence: 1, basis: "known" });
  });

  it("con buena luz la ropa se lee sin error, y el impostor engaña", () => {
    const rng = Rng.root(1).fork("b");
    const r = readStanding({ attire: "fine", clarity: 1, acquainted: false }, 0, defs, rng);
    expect(r?.rank).toBe(2); // un sirviente con ropa fina se lee como terrateniente
    expect(r?.basis).toBe("attire");
  });

  it("sin ropa visible ni conocimiento no hay lectura", () => {
    expect(
      readStanding({ clarity: 1, acquainted: false }, 1, defs, Rng.root(1).fork("c")),
    ).toBeUndefined();
  });

  it("con poca claridad a veces se corre un escalón; con claridad plena nunca", () => {
    let shifted = 0;
    for (let i = 0; i < 200; i++) {
      const r = readStanding(
        { attire: "plain", clarity: 0, acquainted: false },
        1,
        defs,
        Rng.root(i).fork("d"),
      );
      if (r?.rank !== 1) shifted++;
      const clear = readStanding(
        { attire: "plain", clarity: 1, acquainted: false },
        1,
        defs,
        Rng.root(i).fork("d"),
      );
      expect(clear?.rank).toBe(1);
    }
    expect(shifted).toBeGreaterThan(40);
  });

  it("lectura determinista y de rango siempre en la escalera", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1e6 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (seed, clarity) => {
          const go = () =>
            readStanding(
              { attire: "worn", clarity, acquainted: false },
              0,
              defs,
              Rng.root(seed).fork("e"),
            );
          expect(go()).toEqual(go());
          expect([0, 1, 2]).toContain(go()?.rank);
        },
      ),
    );
  });

  it("lo conocido manda sobre lo deducido, y una deducción floja solo mueve un poco", () => {
    let b = updateBeliefs(undefined, a, { rank: 1, confidence: 0.8, basis: "attire" }, 10, ev);
    b = updateBeliefs(b, a, { rank: 2, confidence: 0.2, basis: "told" }, 20, ev);
    const mid = beliefAbout(b, a);
    expect(mid?.rank).toBeGreaterThan(1);
    expect(mid?.rank).toBeLessThan(1.5);
    expect(mid?.basis).toBe("attire");
    b = updateBeliefs(b, a, { rank: 0, confidence: 1, basis: "known" }, 30, ev);
    expect(beliefAbout(b, a)).toMatchObject({ rank: 0, basis: "known", seenAt: 30 });
  });

  it("rankOfAttire promedia los estatus que visten así", () => {
    expect(rankOfAttire("fine", defs)).toBe(2);
    expect(rankOfAttire("worn", [])).toBeUndefined();
  });
});

describe("etiquette y ofensas", () => {
  it("lo que se cree decide la ofensa, no la verdad", () => {
    const believedLow = { rank: 0, confidence: 0.5 };
    const believedHigh = { rank: 2, confidence: 0.5 };
    const input = { offendedRank: 1, actorKnowsEtiquette: 1, witnesses: 0 };
    expect(judgeBreach(norm, { ...input, believedActor: believedLow })).not.toBeNull();
    expect(judgeBreach(norm, { ...input, believedActor: believedHigh })).toBeNull();
    expect(judgeBreach(norm, { ...input, believedActor: undefined })).toBeNull();
  });

  it("crece con los testigos y la distancia, y baja con la ignorancia", () => {
    const base = {
      offendedRank: 2,
      believedActor: { rank: 0, confidence: 1 },
      actorKnowsEtiquette: 1,
      witnesses: 0,
    };
    const solo = judgeBreach(norm, base);
    const public_ = judgeBreach(norm, { ...base, witnesses: 3 });
    const ignorant = judgeBreach(norm, { ...base, actorKnowsEtiquette: 0 });
    const near = judgeBreach(norm, { ...base, believedActor: { rank: 1, confidence: 1 } });
    expect(public_?.size).toBeGreaterThan(solo?.size ?? 1);
    expect(ignorant?.size).toBeLessThan(solo?.size ?? 0);
    expect(near?.size).toBeLessThan(solo?.size ?? 0);
  });

  it("la cara que se pierde es mayor en público y la ofensa siempre queda en 0..1", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5 }),
        fc.integer({ min: -3, max: 8 }),
        fc.integer({ min: 0, max: 20 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (own, believed, witnesses, knows) => {
          const o = judgeBreach(norm, {
            offendedRank: own,
            believedActor: { rank: believed, confidence: 1 },
            actorKnowsEtiquette: knows,
            witnesses,
          });
          if (!o) return;
          expect(o.size).toBeGreaterThanOrEqual(0);
          expect(o.size).toBeLessThanOrEqual(1);
          expect(faceLoss(o)).toBeLessThanOrEqual(o.size + 1e-12);
          expect(faceLoss({ ...o, witnesses: 3 })).toBeGreaterThanOrEqual(
            faceLoss({ ...o, witnesses: 0 }),
          );
        },
      ),
    );
    expect(adjustFace(undefined, -2, 5)).toEqual({ value: 0, updated: 5 });
  });

  it("solo castiga quien está por encima; el magnánimo ignora lo chico", () => {
    const off = { norm: "n", size: 0.6, gap: 1, witnesses: 2 };
    expect(
      respondToOffense(off, { offendedRank: 2, believedActorRank: 0, face: 0.5, magnanimity: 0 }),
    ).toBe("punish");
    expect(
      respondToOffense(off, { offendedRank: 0, believedActorRank: 0, face: 0.5, magnanimity: 0 }),
    ).toBe("rebuke");
    expect(
      respondToOffense(
        { ...off, size: 0.2 },
        { offendedRank: 2, believedActorRank: 0, face: 0.9, magnanimity: 1 },
      ),
    ).toBe("ignore");
  });

  it("fingir más alto y ser descubierto ofende; fingir más bajo no", () => {
    expect(exposureOffense({ claimed: 2, actual: 0, witnesses: 2 })?.size).toBeGreaterThan(
      exposureOffense({ claimed: 1, actual: 0, witnesses: 2 })?.size ?? 1,
    );
    expect(exposureOffense({ claimed: 0, actual: 2, witnesses: 3 })).toBeNull();
  });
});
