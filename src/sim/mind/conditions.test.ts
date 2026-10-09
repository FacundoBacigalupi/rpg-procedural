import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { AgentId, EventId, PlaceRef } from "../../core/index.ts";
import {
  AVOIDANCE_CAP,
  avoidance,
  avoided,
  CONDITION_FLOOR,
  emptyMental,
  falseAlarmChance,
  hypervigilance,
  intrusionChance,
  intrusionEvents,
  NUMBING_CAP,
  nightmareCauses,
  nightmareChance,
  numbedIntensity,
  numbedStimulus,
  numbing,
  openCondition,
  pleasureUtility,
  settleConditions,
  severityOf,
  VIGILANCE_ATTENTION_CAP,
  vigilantAttention,
  vigilantSleepFear,
} from "./conditions.ts";

const EV = (n: number) => `event:${n}` as EventId;
const DEAD = "agent:9" as AgentId;
const DAY = 86_400;
const trigger = { who: DEAD };

describe("condiciones mentales", () => {
  it("abrir una condición cita el evento y suma las siguientes sin pasar de 1", () => {
    let s = emptyMental(EV(1), 0);
    s = openCondition(s, "trauma", 0.6, EV(1), trigger, 0);
    s = openCondition(s, "trauma", 0.6, EV(2), trigger, 10);
    const c = s.conditions.find((x) => x.kind === "trauma");
    expect(c?.originEventIds).toEqual([EV(1), EV(2)]);
    expect(c?.severity).toBeCloseTo(0.84, 5);
    expect(c?.course).toBe("chronic");
  });

  it("lo mínimo no abre nada", () => {
    const s = emptyMental(EV(1), 0);
    expect(openCondition(s, "guilt", CONDITION_FLOOR / 2, EV(1), trigger, 0)).toBe(s);
  });

  it("el tiempo cura y el apoyo cura más rápido; al final se resuelve", () => {
    const s = openCondition(emptyMental(EV(1), 0), "trauma", 0.8, EV(1), trigger, 0);
    const alone = severityOf(settleConditions(s, 90 * DAY, DAY), "trauma");
    const helped = severityOf(settleConditions(s, 90 * DAY, DAY, 1), "trauma");
    expect(alone).toBeCloseTo(0.4, 2);
    expect(helped).toBeLessThan(alone);
    expect(settleConditions(s, 3000 * DAY, DAY).conditions).toEqual([]);
  });

  it("las pesadillas siguen a la gravedad y citan lo que las causó", () => {
    expect(nightmareChance(undefined)).toBe(0);
    const s = openCondition(emptyMental(EV(1), 0), "trauma", 0.8, EV(3), trigger, 0);
    expect(nightmareChance(s)).toBeGreaterThan(0.5);
    expect(nightmareCauses(s)).toEqual([EV(3)]);
    const mild = openCondition(emptyMental(EV(1), 0), "guilt", 0.1, EV(3), trigger, 0);
    expect(nightmareChance(mild)).toBeLessThan(nightmareChance(s));
  });

  it("evitación e intrusión salen del disparador, pesan más con trauma y tienen tope", () => {
    const place = { kind: "cell", cell: "cell:5" } as unknown as PlaceRef;
    const t = openCondition(emptyMental(EV(1), 0), "trauma", 0.8, EV(1), { who: DEAD, place }, 0);
    const g = openCondition(emptyMental(EV(1), 0), "guilt", 0.8, EV(1), trigger, 0);
    expect(avoidance(t, { who: DEAD })).toBeCloseTo(0.8, 5);
    expect(avoidance(t, { place })).toBeCloseTo(0.8, 5);
    expect(avoidance(g, { who: DEAD })).toBeCloseTo(0.48, 5);
    expect(avoidance(t, { who: "agent:1" as AgentId })).toBe(0);
    expect(avoidance(undefined, { who: DEAD })).toBe(0);
    const max = openCondition(t, "trauma", 1, EV(2), { who: DEAD }, 1);
    expect(avoidance(max, { who: DEAD })).toBe(AVOIDANCE_CAP);
    expect(avoided(0.5, 0.8)).toBeCloseTo(0.1, 5);
    expect(intrusionChance(t, { who: DEAD })).toBeCloseTo(0.56, 5);
    expect(intrusionChance(t, { who: "agent:1" as AgentId })).toBe(0);
    expect(intrusionEvents(t, { who: DEAD })).toEqual([EV(1)]);
    expect(intrusionEvents(t, {})).toEqual([]);
  });

  it("hipervigilancia: sube la atención (no la del dormido), el miedo de dormir y las falsas alarmas", () => {
    const t = openCondition(emptyMental(EV(1), 0), "trauma", 0.8, EV(1), trigger, 0);
    const g = openCondition(emptyMental(EV(1), 0), "guilt", 0.8, EV(1), trigger, 0);
    expect(hypervigilance(t)).toBeCloseTo(0.8, 5);
    expect(hypervigilance(g)).toBe(0);
    expect(vigilantAttention(0.8, t)).toBeGreaterThan(0.8);
    expect(vigilantAttention(0.8, t)).toBeLessThanOrEqual(VIGILANCE_ATTENTION_CAP);
    expect(vigilantAttention(0.8, undefined)).toBe(0.8);
    expect(vigilantAttention(0.03, t)).toBe(0.03);
    expect(vigilantAttention(2, t)).toBe(2);
    expect(vigilantSleepFear(t)).toBeGreaterThan(0);
    expect(vigilantSleepFear(undefined)).toBe(0);
    expect(falseAlarmChance(t)).toBeCloseTo(0.16, 5);
    expect(falseAlarmChance(g)).toBe(0);
  });

  it("entumecimiento: baja solo lo positivo, con tope", () => {
    const t = openCondition(emptyMental(EV(1), 0), "trauma", 0.5, EV(1), trigger, 0);
    expect(numbing(t)).toBeCloseTo(0.4, 5);
    expect(numbedIntensity(0.5, 0.6, t)).toBeCloseTo(0.3, 5);
    expect(numbedIntensity(0.5, -0.6, t)).toBe(0.5);
    expect(numbedIntensity(0.5, 0.6, undefined)).toBe(0.5);
    const max = openCondition(t, "trauma", 1, EV(2), trigger, 1);
    expect(numbing(max)).toBe(NUMBING_CAP);
  });

  it("entumecimiento: apaga lo bueno que forma la mente y lo placentero, no lo doloroso", () => {
    const t = openCondition(emptyMental(EV(1), 0), "trauma", 0.5, EV(1), trigger, 0);
    expect(numbedStimulus({ theme: "success", intensity: 0.5 }, t).intensity).toBeCloseTo(0.3, 5);
    expect(numbedStimulus({ theme: "loss", intensity: 0.5 }, t).intensity).toBe(0.5);
    expect(numbedStimulus({ theme: "success", intensity: 0.5 }, undefined).intensity).toBe(0.5);
    expect(pleasureUtility(1, t)).toBeCloseTo(0.6, 5);
    expect(pleasureUtility(-1, t)).toBe(-1);
  });

  it("la gravedad siempre queda en 0-1 y settle no la sube (propiedad)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { maxLength: 8 }),
        fc.nat(2000),
        (hits, days) => {
          let s = emptyMental(EV(1), 0);
          hits.forEach((h, i) => {
            s = openCondition(s, i % 2 ? "guilt" : "trauma", h, EV(i + 1), trigger, 0);
          });
          const after = settleConditions(s, days * DAY, DAY);
          for (const c of after.conditions) {
            expect(c.severity).toBeLessThanOrEqual(1);
            expect(c.severity).toBeGreaterThanOrEqual(CONDITION_FLOOR);
            expect(c.severity).toBeLessThanOrEqual(severityOf(s, c.kind));
          }
        },
      ),
    );
  });
});
