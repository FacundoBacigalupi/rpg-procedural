import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { AgentId, EventId } from "../../core/index.ts";
import {
  CONDITION_FLOOR,
  emptyMental,
  nightmareCauses,
  nightmareChance,
  openCondition,
  settleConditions,
  severityOf,
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
