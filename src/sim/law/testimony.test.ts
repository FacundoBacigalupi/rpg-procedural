import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type AgentId, type EventId, Sfc32, type Tick } from "../../core/index.ts";
import type { Deed } from "./deeds.ts";
import {
  type Accusation,
  type Conscience,
  type DeedRecallContext,
  decideLie,
  guiltOf,
  type HearerView,
  type OwnDeed,
  recallDeed,
  respondToGuilt,
  testify,
  testimonyAsDeed,
  type WitnessMotives,
  weighAccusation,
} from "./testimony.ts";

const A = "agent:1" as AgentId;
const B = "agent:2" as AgentId;
const C = "agent:3" as AgentId;
const D = "agent:4" as AgentId;
const DAY = 86_400;
const rng = (n: number) => new Sfc32(n, 7, 11, 13);

const deed = (over: Partial<Deed> = {}): Deed => ({
  kind: "theft",
  by: A,
  victim: B,
  event: "event:1" as EventId,
  at: 0 as Tick,
  via: "saw",
  ...over,
});
const ctx = (over: Partial<DeedRecallContext> = {}): DeedRecallContext => ({
  now: 0 as Tick,
  clarity: 1,
  affinityToDoer: 0,
  affinityToVictim: 0,
  suspect: null,
  bias: 0.5,
  ...over,
});
const calm: WitnessMotives = {
  fear: 0,
  loyaltyToDoer: 0,
  bribe: 0,
  hatredOfOther: 0,
  honesty: 0.5,
  skill: 0.5,
};

describe("recordar", () => {
  it("recién visto y con buena luz queda tal cual", () => {
    for (let s = 0; s < 30; s++) {
      const r = recallDeed(deed(), ctx(), rng(s));
      expect(r.deed).toEqual(deed());
      expect(r.distortion).toBe(0);
    }
  });

  it("la confianza baja con el tiempo y con la mala vista, y lo oído nace menos firme", () => {
    const fresh = recallDeed(deed(), ctx(), rng(1)).confidence;
    const old = recallDeed(deed(), ctx({ now: (90 * DAY) as Tick }), rng(1)).confidence;
    const dim = recallDeed(deed(), ctx({ clarity: 0.1 }), rng(1)).confidence;
    const told = recallDeed(deed({ via: "told" }), ctx(), rng(1)).confidence;
    expect(old).toBeLessThan(fresh);
    expect(dim).toBeLessThan(fresh);
    expect(told).toBeLessThan(fresh);
  });

  it("sin saber quién fue, solo puede colgarle el hecho al sospechoso que ya tenía", () => {
    let blamed = 0;
    for (let s = 0; s < 200; s++) {
      const r = recallDeed(
        deed({ by: null, via: "heard" }),
        ctx({ now: (60 * DAY) as Tick, clarity: 0.2, suspect: C, bias: 1 }),
        rng(s),
      );
      expect([null, C]).toContain(r.deed.by);
      if (r.deed.by === C) blamed++;
      const noSuspect = recallDeed(deed({ by: null }), ctx({ clarity: 0.2, bias: 1 }), rng(s));
      expect(noSuspect.deed.by).toBeNull();
    }
    expect(blamed).toBeGreaterThan(0);
  });

  it("el rencor agranda el hecho y el cariño lo achica", () => {
    let up = 0;
    let down = 0;
    const base = ctx({ now: (60 * DAY) as Tick, clarity: 0.3, bias: 1 });
    for (let s = 0; s < 300; s++) {
      if (recallDeed(deed(), { ...base, affinityToDoer: -1 }, rng(s)).deed.kind === "assault") up++;
      if (recallDeed(deed(), { ...base, affinityToDoer: 1 }, rng(s)).deed.kind === "default")
        down++;
      expect(recallDeed(deed(), { ...base, affinityToDoer: 1 }, rng(s)).deed.kind).not.toBe(
        "assault",
      );
    }
    expect(up).toBeGreaterThan(0);
    expect(down).toBeGreaterThan(0);
  });

  it("consume siempre los mismos sorteos", () => {
    const a = rng(5);
    const b = rng(5);
    recallDeed(deed(), ctx(), a);
    recallDeed(deed(), ctx({ clarity: 0, bias: 1, affinityToDoer: -1 }), b);
    expect(a.u32()).toBe(b.u32());
  });
});

describe("mentir", () => {
  it("sin motivos nadie miente", () => {
    for (let s = 0; s < 50; s++) expect(decideLie(calm, rng(s)).kind).toBe("none");
  });

  it("el miedo y el soborno niegan; el odio inventa o inculpa", () => {
    const fear = decideLie({ ...calm, fear: 0.95, honesty: 0.2 }, rng(1));
    expect(fear.kind).toBe("deny");
    expect(fear.motive).toBe("fear");
    expect(decideLie({ ...calm, bribe: 0.95, honesty: 0.2 }, rng(1)).kind).toBe("deny");
    const kinds = new Set<string>();
    for (let s = 0; s < 50; s++)
      kinds.add(decideLie({ ...calm, hatredOfOther: 0.95, honesty: 0.2 }, rng(s)).kind);
    expect([...kinds].sort()).toEqual(["frame", "invent"]);
  });

  it("la honestidad alta frena el motivo moderado", () => {
    for (let s = 0; s < 50; s++)
      expect(decideLie({ ...calm, fear: 0.5, honesty: 0.9 }, rng(s)).kind).toBe("none");
  });

  it("la mentira es más pulida con más habilidad (propiedad)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 999 }), (s) => {
        const m = { ...calm, fear: 1, honesty: 0 };
        const lo = decideLie({ ...m, skill: 0.1 }, rng(s));
        const hi = decideLie({ ...m, skill: 0.9 }, rng(s));
        expect(hi.polish).toBeGreaterThan(lo.polish);
      }),
    );
  });
});

describe("declarar", () => {
  it("el honesto cuenta lo que recuerda", () => {
    const t = testify(deed(), ctx(), calm, D, rng(1));
    expect(t.accused).toBe(A);
    expect(t.kind).toBe("theft");
    expect(t.lie.kind).toBe("none");
  });

  it("el que teme niega: no queda hecho que contar", () => {
    const t = testify(deed(), ctx(), { ...calm, fear: 1, honesty: 0 }, D, rng(1));
    expect(t.kind).toBeNull();
    expect(testimonyAsDeed(t)).toBeNull();
  });

  it("el que odia a otro lo inculpa, y lo dicho entra como «me contaron»", () => {
    const m = { ...calm, hatredOfOther: 1, honesty: 0 };
    const t = testify(deed(), ctx(), m, D, rng(2));
    expect(t.lie.kind === "frame" || t.lie.kind === "invent").toBe(true);
    expect(t.accused).toBe(D);
    expect(testimonyAsDeed(t)?.via).toBe("told");
    expect(testify(deed(), ctx(), m, null, rng(2)).accused).toBeNull();
  });
});

describe("acusaciones", () => {
  const acc = (over: Partial<Accusation> = {}): Accusation => ({
    accuser: C,
    accused: A,
    kind: "theft",
    victim: B,
    event: "event:1" as EventId,
    certainty: 0.9,
    ...over,
  });
  const ear = (over: Partial<HearerView> = {}): HearerView => ({
    trustInAccuser: 0.8,
    affinityToAccused: 0,
    ownKnowledge: null,
    gullibility: 0.6,
    stake: 0,
    ...over,
  });

  it("una acusación firme de alguien confiable sube la creencia", () => {
    expect(weighAccusation(acc(), ear(), 0).belief).toBeGreaterThan(0.3);
  });

  it("el cariño la frena y lo que ya sabía la confirma", () => {
    const base = weighAccusation(acc(), ear(), 0).belief;
    expect(weighAccusation(acc(), ear({ affinityToAccused: 1 }), 0).belief).toBeLessThan(base);
    expect(weighAccusation(acc(), ear({ ownKnowledge: deed() }), 0).belief).toBeGreaterThan(base);
  });

  it("sin hecho que mostrar y con interés en juego suena a calumnia", () => {
    const r = weighAccusation(acc({ event: null }), ear({ trustInAccuser: 0.3, stake: 0.9 }), 0);
    expect(r.suspectsLiar).toBe(true);
    expect(r.belief).toBeLessThan(weighAccusation(acc(), ear({ trustInAccuser: 0.3 }), 0).belief);
  });

  it("la creencia queda en 0-1 (propiedad)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: -1, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (t, aff, prior) => {
          const r = weighAccusation(
            acc(),
            ear({ trustInAccuser: t, affinityToAccused: aff }),
            prior,
          );
          expect(r.belief).toBeGreaterThanOrEqual(0);
          expect(r.belief).toBeLessThanOrEqual(1);
        },
      ),
    );
  });
});

describe("culpa", () => {
  const own: OwnDeed = {
    kind: "assault",
    victim: B,
    at: 0 as Tick,
    event: "event:9" as EventId,
    harm: 0.9,
  };
  const soul: Conscience = {
    bondToVictim: 0.8,
    moralWeight: 0.9,
    justification: 0,
    fearOfExposure: 0.1,
  };

  it("pesa más herir que deber, y menos si se justifica", () => {
    const g = guiltOf(own, soul, 0 as Tick);
    expect(g).toBeGreaterThan(guiltOf({ ...own, kind: "default" }, soul, 0 as Tick));
    expect(guiltOf(own, { ...soul, justification: 1 }, 0 as Tick)).toBeLessThan(g);
  });

  it("se apaga con el tiempo", () => {
    expect(guiltOf(own, soul, (200 * DAY) as Tick)).toBeLessThan(guiltOf(own, soul, 0 as Tick));
  });

  it("mucha culpa confiesa o repara; con mucho miedo desvía", () => {
    const high = guiltOf(own, soul, 0 as Tick);
    for (let s = 0; s < 30; s++)
      expect(["confess", "repair"]).toContain(respondToGuilt(high, soul, true, rng(s)));
    expect(respondToGuilt(high, { ...soul, fearOfExposure: 1 }, true, rng(1))).toBe("deflect");
    expect(respondToGuilt(0, soul, true, rng(1))).toBe("none");
  });

  it("sin conciencia la culpa es baja (propiedad)", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), (harm) => {
        const g = guiltOf(
          { ...own, harm },
          { ...soul, moralWeight: 0, bondToVictim: 0 },
          0 as Tick,
        );
        expect(g).toBeLessThan(0.3);
        expect(g).toBeGreaterThanOrEqual(0);
      }),
    );
  });
});
