import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { AgentId, EventId } from "../../core/index.ts";
import {
  chronicStressOf,
  complicateGrief,
  depressionPressure,
  griefComplication,
  griefSeverity,
  helplessness,
  openChronicDepression,
  openDepression,
  openGrief,
} from "./condition-onset.ts";
import {
  CONDITION_HALF_LIFE_DAYS,
  emptyMental,
  nightmareChance,
  numbing,
  openCondition,
  settleConditions,
  severityOf,
} from "./conditions.ts";
import type { Mind } from "./mind.ts";

const EV = (n: number) => `event:${n}` as EventId;
const WHO = "agent:3" as AgentId;
const DAY = 86_400;
const calm = { chronicStress: 0, losses: 0, illness: 0, isolation: 0 };
const mind = (effort: number, unworthy: number): Mind => ({
  schemas: {
    effort_pays: { strength: effort, causes: [] },
    i_am_unworthy: { strength: unworthy, causes: [] },
  },
  formative: [],
  originEventId: EV(0),
});

describe("duelo y depresión", () => {
  it("el duelo crece con la relación y con el modo de la muerte", () => {
    expect(griefSeverity(0.9)).toBeGreaterThan(griefSeverity(0.3));
    expect(griefSeverity(0.6, { violent: true, noBody: true })).toBeGreaterThan(griefSeverity(0.6));
    expect(griefSeverity(1, { violent: true, noBody: true, ownFault: true })).toBe(1);
    expect(griefSeverity(0)).toBe(0);
  });

  it("abrir un duelo cita el evento y el difunto es el disparador", () => {
    const s = openGrief(emptyMental(EV(1), 0), WHO, 0.9, {}, EV(2), 5);
    const c = s.conditions.find((x) => x.kind === "grief");
    expect(c?.originEventIds).toEqual([EV(2)]);
    expect(c?.triggers).toEqual([{ who: WHO }]);
    expect(nightmareChance(s)).toBeGreaterThan(0);
    expect(numbing(s)).toBeGreaterThan(0);
  });

  it("los tipos nuevos decaen a su vida media", () => {
    const s = openGrief(emptyMental(EV(1), 0), WHO, 1, {}, EV(2), 0);
    const g0 = severityOf(s, "grief");
    const g = severityOf(settleConditions(s, CONDITION_HALF_LIFE_DAYS.grief * DAY, DAY), "grief");
    expect(g).toBeCloseTo(g0 / 2, 2);
  });

  it("el duelo se complica sin rito, con culpa, repetido o sin apoyo", () => {
    let s = openGrief(emptyMental(EV(1), 0), WHO, 0.9, {}, EV(2), 0);
    const good = { riteHeld: true, support: 0.8 };
    expect(griefComplication(s, good)).toBe(0);
    expect(griefComplication(s, { ...good, riteHeld: false })).toBeGreaterThan(0);
    expect(griefComplication(s, { ...good, support: 0 })).toBeGreaterThan(0);
    s = openCondition(s, "guilt", 0.4, EV(3), {}, 0);
    expect(griefComplication(s, good)).toBeGreaterThan(0);
    expect(griefComplication(undefined, good)).toBe(0);
  });

  it("el duelo bien llevado no deriva; el complicado abre depresión citando la pérdida", () => {
    const s = openGrief(emptyMental(EV(1), 0), WHO, 0.9, { violent: true }, EV(2), 0);
    expect(complicateGrief(s, { riteHeld: true, support: 0.8 }, 1)).toBe(s);
    const out = complicateGrief(s, { riteHeld: false, support: 0 }, 1);
    const d = out.conditions.find((x) => x.kind === "depression");
    expect(d?.originEventIds).toEqual([EV(2)]);
    expect(severityOf(out, "depression")).toBeGreaterThan(0);
    expect(severityOf(out, "grief")).toBe(severityOf(s, "grief"));
  });

  it("la indefensión sale de los esquemas", () => {
    expect(helplessness(undefined)).toBe(0);
    expect(helplessness(mind(0.9, 0))).toBeLessThan(helplessness(mind(0.1, 0.8)));
  });

  it("la depresión necesita presión sobre el umbral y la indefensión la empuja", () => {
    const s = emptyMental(EV(1), 0);
    expect(openDepression(s, calm, undefined, EV(2), 0)).toBe(s);
    const heavy = { chronicStress: 0.9, losses: 0.8, illness: 0.3, isolation: 0.7 };
    const a = openDepression(s, heavy, mind(0.9, 0), EV(2), 0);
    const b = openDepression(s, heavy, mind(0.1, 0.9), EV(2), 0);
    expect(severityOf(b, "depression")).toBeGreaterThan(severityOf(a, "depression"));
    expect(b.conditions[0]?.originEventIds).toEqual([EV(2)]);
  });

  it("la presión y la gravedad quedan en 0-1 (propiedad)", () => {
    const u = fc.double({ min: 0, max: 1, noNaN: true });
    fc.assert(
      fc.property(u, u, u, u, u, u, (a, b, c, d, e, f) => {
        const pr = { chronicStress: a, losses: b, illness: c, isolation: d };
        const p = depressionPressure(pr, mind(e, f));
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
        const s = openDepression(emptyMental(EV(1), 0), pr, mind(e, f), EV(2), 0);
        expect(severityOf(s, "depression")).toBeLessThanOrEqual(1);
      }),
    );
  });
});

describe("depresión por estrés crónico", () => {
  const NOW = 100 * DAY;
  const hurt = (n: number, daysAgo: number, valence = -0.9) => ({
    eventId: EV(n),
    at: NOW - daysAgo * DAY,
    intensity: 0.9,
    valence,
  });
  const many = [hurt(1, 1), hurt(2, 2), hurt(3, 3), hurt(4, 5), hurt(5, 8)];

  it("sin dolor reciente no hay estrés ni causa", () => {
    expect(chronicStressOf([hurt(1, 90)], NOW, DAY)).toEqual({ stress: 0 });
    expect(chronicStressOf([hurt(1, 1, 0.8)], NOW, DAY)).toEqual({ stress: 0 });
  });

  it("el dolor repetido abre depresión citando el golpe más fuerte, una sola vez", () => {
    const base = emptyMental(EV(0), NOW);
    const opened = openChronicDepression(base, many, mind(0, 0.9), NOW, DAY);
    expect(severityOf(opened, "depression")).toBeGreaterThan(0);
    expect(opened.conditions[0]?.originEventIds).toEqual([EV(1)]);
    expect(openChronicDepression(opened, many, mind(0, 0.9), NOW, DAY)).toBe(opened);
  });

  it("un golpe aislado con ánimo entero no abre nada, y es determinista", () => {
    const base = emptyMental(EV(0), NOW);
    expect(openChronicDepression(base, [hurt(1, 1)], mind(0.8, 0), NOW, DAY)).toBe(base);
    expect(openChronicDepression(base, many, mind(0, 0.9), NOW, DAY)).toEqual(
      openChronicDepression(base, many, mind(0, 0.9), NOW, DAY),
    );
  });
});
