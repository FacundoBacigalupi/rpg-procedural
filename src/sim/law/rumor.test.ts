import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type AgentId, type EventId, Sfc32, type Tick } from "../../core/index.ts";
import {
  type DistortContext,
  decidesToTell,
  distortRumor,
  firstHand,
  type HearContext,
  hearRumor,
  keepRumor,
  type Rumors,
  reputationIn,
  rumorCredit,
  rumorTree,
  spoken,
  type TellMotives,
  tellDesire,
} from "./rumor.ts";

const A = "agent:1" as AgentId;
const B = "agent:2" as AgentId;
const C = "agent:3" as AgentId;
const D = "agent:4" as AgentId;
const E1 = "event:1" as EventId;
const rng = (n: number) => new Sfc32(n, 3, 5, 7);
const content = { kind: "theft", by: A, victim: B, severity: 1 } as const;
const calm: DistortContext = { memory: 1, drama: 0, hurry: 0, grudge: null };
const hear: HearContext = { trustInTeller: 0.8, affectionToDoer: 0, credulity: 0.5, attention: 1 };
const motives: TellMotives = {
  content,
  ageDays: 1,
  relevance: 0.5,
  sociability: 0.6,
  protects: 0,
  fearOfDoer: 0,
  trustInListener: 0.5,
  alreadyTold: false,
};

describe("distortRumor", () => {
  it("con memoria perfecta y sin drama no cambia nada", () => {
    for (let i = 0; i < 20; i++) {
      expect(distortRumor(content, calm, rng(i)).content).toEqual(content);
    }
  });
  it("solo mete valores que el narrador tenía y nunca culpa a la víctima", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 500 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (n, x) => {
          const ctx: DistortContext = {
            memory: 1 - x,
            drama: x,
            hurry: x,
            grudge: { who: C, strength: x },
          };
          const out = distortRumor(content, ctx, rng(n)).content;
          expect([A, C, null]).toContain(out.by);
          expect(out.victim).toBe(B);
          expect(out.severity).toBeLessThanOrEqual(2);
        },
      ),
    );
  });
  it("el rencor desliza la culpa y la exageración sube la clase", () => {
    let slid = 0;
    let up = 0;
    for (let i = 0; i < 200; i++) {
      const r = distortRumor(
        { ...content, by: null },
        { memory: 0.2, drama: 1, hurry: 0, grudge: { who: C, strength: 1 } },
        rng(i),
      );
      if (r.content.by === C) slid++;
      if (r.content.kind === "assault") up++;
    }
    expect(slid).toBeGreaterThan(60);
    expect(up).toBe(0); // una sola pasada no llega a ESCALATE_AT
    let hop = content as ReturnType<typeof distortRumor>["content"];
    for (let i = 0; i < 4; i++) {
      hop = distortRumor(hop, { memory: 1, drama: 1, hurry: 0, grudge: null }, rng(i * 7)).content;
    }
    expect(hop.severity).toBeGreaterThan(1);
  });
  it("es determinista", () => {
    const ctx = { memory: 0.3, drama: 0.7, hurry: 0.2, grudge: { who: C, strength: 0.5 } };
    expect(distortRumor(content, ctx, rng(9))).toEqual(distortRumor(content, ctx, rng(9)));
  });
});

describe("tellDesire", () => {
  it("proteger o temer al culpable apaga las ganas, y lo ya contado vale cero", () => {
    const base = tellDesire(motives);
    expect(base).toBeGreaterThan(0.25);
    expect(tellDesire({ ...motives, protects: 1, fearOfDoer: 1 })).toBe(0);
    expect(tellDesire({ ...motives, alreadyTold: true })).toBe(0);
    expect(tellDesire({ ...motives, ageDays: 40 })).toBeLessThan(base);
  });
  it("bajo el piso no se cuenta", () => {
    expect(decidesToTell(0.1, rng(1))).toBe(false);
  });
});

describe("hearRumor", () => {
  const told = spoken(firstHand(E1, content, 0 as Tick, 0 as Tick, A), content);
  it("la credibilidad baja con los saltos y con el cariño al acusado", () => {
    expect(rumorCredit(hear, 3)).toBeLessThan(rumorCredit(hear, 0));
    expect(rumorCredit({ ...hear, affectionToDoer: 1 }, 1)).toBeLessThan(rumorCredit(hear, 1));
  });
  it("«todos lo dicen»: otra boca sube la confianza; la misma no", () => {
    const first = hearRumor(undefined, told, B, C, hear, 10 as Tick, rng(1));
    expect(first.parent).toBe(told.variant);
    expect(first.teller).toBe(B);
    const same = hearRumor(first, told, B, C, hear, 20 as Tick, rng(2));
    expect(same.confidence).toBe(first.confidence);
    const other = hearRumor(first, told, D, C, hear, 20 as Tick, rng(3));
    expect(other.confidence).toBeGreaterThan(first.confidence);
    expect(other.voices).toBe(2);
  });
  it("lo que vio no se pisa con lo que oye", () => {
    const seen = firstHand(E1, content, 0 as Tick, 0 as Tick, C);
    expect(hearRumor(seen, told, B, C, hear, 5 as Tick, rng(1))).toBe(seen);
  });
});

describe("linaje y reputación", () => {
  const seen = firstHand(E1, content, 0 as Tick, 0 as Tick, A);
  const toB = hearRumor(undefined, spoken(seen, content), A, B, hear, 5 as Tick, rng(1));
  const toC = hearRumor(undefined, spoken(toB, content), B, C, hear, 9 as Tick, rng(2));
  const rumors = new Map<AgentId, Rumors | undefined>([
    [A, keepRumor(undefined, seen)],
    [B, keepRumor(undefined, toB)],
    [C, keepRumor(undefined, toC)],
  ]);
  it("el árbol ordena por saltos y cada hijo apunta a su padre", () => {
    const l = rumorTree(E1, rumors);
    expect(l.variants.map((v) => v.hops)).toEqual([0, 1, 2]);
    expect(l.variants[2]?.parent).toBe(l.variants[1]?.variant);
  });
  it("la reputación es por comunidad", () => {
    const get = (id: AgentId) => rumors.get(id);
    const village = reputationIn([A, B, C, D], A, () => undefined, get);
    expect(village.fame).toBeCloseTo(2 / 3, 5);
    expect(village.standing).toBeLessThan(0);
    expect(village.dominant).toBe("theft");
    const elsewhere = reputationIn([A, D], A, () => undefined, get);
    expect(elsewhere.fame).toBe(0);
  });
});
