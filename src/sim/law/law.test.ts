import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { AgentId, EventId, Tick } from "../../core/index.ts";
import {
  culpability,
  type Deed,
  KEPT_DEEDS,
  learnDeed,
  MAX_CULPABILITY,
  NOTORIETY_EDGE,
  notoriety,
  notorietyEdge,
  penaltyScale,
  REPORT_EDGE,
  reportable,
  worstDeed,
} from "./deeds.ts";
import { bloodStrength, type Trace, traceStrength, traceVisible } from "./traces.ts";

const A = "agent:1" as AgentId;
const B = "agent:2" as AgentId;
const C = "agent:3" as AgentId;
const deed = (n: number, over: Partial<Deed> = {}): Deed => ({
  kind: "theft",
  by: A,
  victim: B,
  event: `event:${n}` as EventId,
  at: n as Tick,
  via: "saw",
  ...over,
});

describe("lo que se sabe de un hecho", () => {
  it("el mismo evento no se guarda dos veces ni lo oído pisa lo visto", () => {
    const seen = learnDeed(undefined, deed(1));
    expect(learnDeed(seen, deed(1, { via: "told" }))).toBe(seen);
  });

  it("saber quién fue pisa el «no sé quién»", () => {
    const vague = learnDeed(undefined, deed(1, { by: null, via: "heard" }));
    const named = learnDeed(vague, deed(1, { via: "told" }));
    expect(named.deeds).toHaveLength(1);
    expect(named.deeds[0]?.by).toBe(A);
  });

  it("olvida lo más viejo al pasar el tope", () => {
    let k = learnDeed(undefined, deed(0));
    for (let i = 1; i <= KEPT_DEEDS + 3; i++) k = learnDeed(k, deed(i));
    expect(k.deeds).toHaveLength(KEPT_DEEDS);
    expect(k.deeds[0]?.event).toBe("event:4");
  });

  it("lo peor que se sabe de alguien es herir antes que robar, y solo con su nombre", () => {
    let k = learnDeed(undefined, deed(1));
    k = learnDeed(k, deed(2, { kind: "assault" }));
    k = learnDeed(k, deed(3, { kind: "assault", by: C }));
    expect(worstDeed(k, A)?.kind).toBe("assault");
    expect(worstDeed(k, B)).toBeNull();
    expect(worstDeed(undefined, A)).toBeNull();
  });
});

describe("la fama", () => {
  it("es la fracción de la aldea que sabe algo de quien la tiene", () => {
    const knows = learnDeed(undefined, deed(1));
    const doesnt = learnDeed(undefined, deed(2, { by: null, via: "heard" }));
    expect(notoriety([knows, knows, undefined, doesnt], A)).toBe(0.5);
    expect(notoriety([], A)).toBe(0);
  });

  it("baja el trato hasta un tope y nunca lo sube (propiedad)", () => {
    fc.assert(
      fc.property(fc.double({ min: -2, max: 3, noNaN: true }), (fame) => {
        const edge = notorietyEdge(fame);
        expect(edge).toBeLessThanOrEqual(0);
        expect(edge).toBeGreaterThanOrEqual(-NOTORIETY_EDGE);
      }),
    );
  });
});

describe("huellas", () => {
  const trace = (strength: number): Trace => ({
    kind: "blood",
    at: { hex: 1 },
    made: 0 as Tick,
    by: [A, B],
    event: "event:1" as EventId,
    strength,
  });

  it("se borran con las horas, sin subir nunca", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.1, max: 1, noNaN: true }),
        fc.integer({ min: 0, max: 10 * 86_400 }),
        fc.integer({ min: 0, max: 10 * 86_400 }),
        (s, t1, t2) => {
          const [early, late] = t1 <= t2 ? [t1, t2] : [t2, t1];
          const t = trace(s);
          expect(traceStrength(t, late as Tick)).toBeLessThanOrEqual(
            traceStrength(t, early as Tick) + 1e-12,
          );
        },
      ),
    );
  });

  it("una mancha fuerte se ve ese día y deja de verse a la semana", () => {
    const t = trace(bloodStrength(0.8));
    expect(traceVisible(t, 3600 as Tick)).toBe(true);
    expect(traceVisible(t, (7 * 86_400) as Tick)).toBe(false);
  });

  it("la lluvia lava lo de afuera y no toca lo de adentro", () => {
    const out = trace(bloodStrength(0.8));
    const inside: Trace = { ...out, at: { hex: 1, space: "house:1" } };
    const now = 3600 as Tick;
    expect(traceVisible(out, now, 0)).toBe(true);
    expect(traceVisible(out, now, 30)).toBe(false);
    expect(traceStrength(out, now, 6)).toBeCloseTo(traceStrength(out, now, 0) / 2, 10);
    expect(traceStrength(inside, now, 30)).toBe(traceStrength(inside, now, 0));
  });
});

describe("juzgar según el porqué leído", () => {
  it("sin lectura la culpa es plena y el regalo leído la desestima", () => {
    expect(culpability(deed(1))).toBe(1);
    const gift = deed(2, { read: { weight: 0.8 } });
    expect(culpability(gift)).toBeLessThan(REPORT_EDGE);
    expect(reportable(gift)).toBe(false);
    expect(penaltyScale(gift)).toBe(0);
  });

  it("el robo leído pesa más y la duda acerca la culpa a 1", () => {
    const sure = deed(3, { read: { weight: -0.8 } });
    const unsure = deed(4, { read: { weight: -0.32 } });
    expect(culpability(sure)).toBeGreaterThan(culpability(unsure));
    expect(culpability(unsure)).toBeGreaterThan(1);
    expect(penaltyScale(sure)).toBeLessThanOrEqual(MAX_CULPABILITY);
    expect(reportable(sure)).toBe(true);
  });
});
