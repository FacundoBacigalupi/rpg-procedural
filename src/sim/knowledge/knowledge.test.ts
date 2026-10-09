import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { AgentId } from "../../core/index.ts";
import {
  BELIEF_CAPACITY,
  type Belief,
  type Beliefs,
  beliefConfidenceAt,
  CONFIDENCE_CAP,
  CONFIDENCE_HALF_LIFE_HOURS,
  type Evidence,
  learn,
  revise,
} from "./belief.ts";

const HOUR = 3_600;
const WHO = "agent:1" as AgentId;
const at = (hex: number, space?: string) => (space === undefined ? { hex } : { hex, space });
const seen = (hex: number, confidence: number, tick: number): Evidence => ({
  prop: { kind: "attr", subject: WHO, attr: "at" },
  value: at(hex),
  confidence,
  asOf: tick,
  source: { kind: "percept", percept: `p@${tick}`, tick },
});

describe("revisar una creencia", () => {
  it("la primera evidencia crea la creencia con su fuente y su hora", () => {
    const b = revise(undefined, seen(3, 0.8, 100), 100);
    expect(b.value).toEqual(at(3));
    expect(b.confidence).toBe(0.8);
    expect(b.asOf).toBe(100);
    expect(b.learnedAt).toBe(100);
    expect(b.sources).toHaveLength(1);
  });

  it("ver lo mismo refuerza sin pasar del tope", () => {
    let b = revise(undefined, seen(3, 0.6, 0), 0);
    for (let i = 1; i < 30; i++) {
      const next = revise(b, seen(3, 0.6, 0), 0);
      expect(next.confidence).toBeGreaterThanOrEqual(b.confidence);
      b = next;
    }
    expect(b.confidence).toBeLessThanOrEqual(CONFIDENCE_CAP);
    expect(b.confidence).toBeGreaterThan(0.9);
  });

  it("la confianza en dónde está alguien envejece en horas", () => {
    const b = revise(undefined, seen(3, 0.9, 0), 0);
    const half = CONFIDENCE_HALF_LIFE_HOURS.at * HOUR;
    expect(beliefConfidenceAt(b, half)).toBeCloseTo(0.45, 3);
    expect(beliefConfidenceAt(b, 10 * half)).toBeLessThan(0.01);
  });

  it("lo nuevo y distinto reemplaza a lo viejo ya dudoso, pero llega con menos confianza", () => {
    const old = revise(undefined, seen(3, 0.9, 0), 0);
    const later = 12 * HOUR;
    const b = revise(old, seen(7, 0.9, later), later);
    expect(b.value).toEqual(at(7));
    expect(b.confidence).toBeLessThan(0.9);
    expect(b.asOf).toBe(later);
    expect(b.sources).toHaveLength(2);
  });

  it("una evidencia floja no desplaza lo que se creía con fuerza", () => {
    const strong = revise(undefined, seen(3, 0.98, 0), 0);
    const b = revise(strong, seen(7, 0.2, 60), 60);
    expect(b.value).toEqual(at(3));
    expect(b.confidence).toBeLessThan(strong.confidence);
  });

  it("evidencia más vieja que lo que cree pesa menos", () => {
    const base = revise(undefined, seen(3, 0.5, 1000 * HOUR), 1000 * HOUR);
    const fresh = revise(base, seen(7, 0.6, 1000 * HOUR), 1000 * HOUR);
    const stale = revise(base, seen(7, 0.6, 500 * HOUR), 1000 * HOUR);
    expect(fresh.value).toEqual(at(7));
    expect(stale.value).toEqual(at(3));
  });

  it("la confianza queda en 0-1 y la saliencia también", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            hex: fc.integer({ min: 0, max: 3 }),
            c: fc.double({ min: 0, max: 1, noNaN: true }),
            dt: fc.integer({ min: 0, max: 48 }),
          }),
          { minLength: 1, maxLength: 25 },
        ),
        (steps) => {
          let b: Belief | undefined;
          let t = 0;
          for (const s of steps) {
            t += s.dt * HOUR;
            b = revise(b, seen(s.hex, s.c, t), t);
            expect(b.confidence).toBeGreaterThanOrEqual(0);
            expect(b.confidence).toBeLessThanOrEqual(1);
            expect(b.salience).toBeLessThanOrEqual(1);
          }
        },
      ),
    );
  });

  it("es determinista: la misma secuencia da las mismas creencias", () => {
    const run = () => {
      let before: Beliefs | undefined;
      for (let i = 0; i < 10; i++) before = learn(before, seen(i % 3, 0.7, i * HOUR), i * HOUR);
      return JSON.stringify(before);
    };
    expect(run()).toBe(run());
  });
});

describe("aprender", () => {
  it("hay una sola creencia por proposición", () => {
    let b: Beliefs | undefined;
    for (let i = 0; i < 5; i++) b = learn(b, seen(i, 0.9, i), i);
    expect(b?.items).toHaveLength(1);
  });

  it("la capacidad se respeta y se olvida lo menos saliente", () => {
    let b: Beliefs | undefined;
    for (let k = 0; k < BELIEF_CAPACITY + 10; k++) {
      const subject = `agent:${k + 10}` as AgentId;
      const ev: Evidence = {
        ...seen(1, 0.3 + (k % 7) / 10, k),
        prop: { kind: "attr", subject, attr: "at" },
      };
      b = learn(b, ev, k);
    }
    expect(b?.items.length).toBe(BELIEF_CAPACITY);
  });
});

describe("atributos de texto: figura, ropa y acción", () => {
  const text = (attr: "figure" | "attire" | "action", value: string, tick: number): Evidence => ({
    prop: { kind: "attr", subject: WHO, attr },
    value,
    confidence: 0.8,
    asOf: tick,
    source: { kind: "percept", percept: `p@${tick}`, tick },
  });

  it("guardan texto, una creencia por atributo, y lo igual refuerza", () => {
    let b: Beliefs | undefined;
    b = learn(b, text("figure", "female:adult", 0), 0);
    b = learn(b, text("attire", "plain", 0), 0);
    b = learn(b, text("figure", "female:adult", HOUR), HOUR);
    expect(b?.items).toHaveLength(2);
    const fig = b?.items.find((i) => i.prop.attr === "figure");
    expect(fig?.value).toBe("female:adult");
    expect(fig?.confidence).toBeGreaterThan(0.8);
  });

  it("lo distinto con evidencia más fuerte reemplaza, y cada uno envejece a su ritmo", () => {
    const old = revise(undefined, text("attire", "plain", 0), 0);
    const next = revise(old, { ...text("attire", "silk", HOUR), confidence: 0.99 }, HOUR);
    expect(next.value).toBe("silk");
    const act = revise(undefined, text("action", "chop", 0), 0);
    const fig = revise(undefined, text("figure", "male:elder", 0), 0);
    const later = 12 * HOUR;
    expect(beliefConfidenceAt(act, later)).toBeLessThan(beliefConfidenceAt(fig, later));
    expect(CONFIDENCE_HALF_LIFE_HOURS.action).toBeLessThan(CONFIDENCE_HALF_LIFE_HOURS.attire);
  });
});
