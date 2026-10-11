import { describe, expect, it } from "vitest";
import { makeId, type Tick } from "../../core/index.ts";
import {
  CRAFT_MIN_SESSIONS,
  craftEvidence,
  craftGoalId,
  craftGoals,
  nextMilestone,
  type PracticeEntry,
  parseCraftGoal,
} from "./craft-goals.ts";
import { goalCompletionsFromProgress } from "./goal-progress-evidence.ts";

const DAY = 86_400;
const entry = (n: number, at: number, skill = "farming", hours = 2): PracticeEntry => ({
  skill,
  event: makeId("event", n),
  at: at as Tick,
  hours,
});
const now = (40 * DAY) as Tick;
const log = [entry(1, 10 * DAY), entry(2, 12 * DAY), entry(3, 20 * DAY), entry(4, 30 * DAY)];

describe("sim.mind.craft-goals", () => {
  it("hitos y ids se ida y vuelta", () => {
    expect(nextMilestone(0)).toBe(0.25);
    expect(nextMilestone(0.25)).toBe(0.5);
    expect(nextMilestone(0.8)).toBeUndefined();
    expect(parseCraftGoal(craftGoalId("farming", 0.5))).toEqual({
      skill: "farming",
      milestone: 0.5,
    });
    expect(parseCraftGoal("medium:debt:agent:2")).toBeUndefined();
  });

  it("nace de práctica repetida reciente con el hito siguiente y la primera sesión como origen", () => {
    const [g] = craftGoals(log, { farming: 0.1 }, now, 60 * DAY);
    expect(g).toMatchObject({
      id: "medium:craft:farming:0.25",
      layer: "medium",
      originEventId: makeId("event", 1),
      since: now,
    });
    // fuera de ventana, pocas sesiones, sin hito o sesiones inválidas: no hay meta
    expect(craftGoals(log, { farming: 0.1 }, now, 15 * DAY)).toHaveLength(0);
    expect(craftGoals(log.slice(0, CRAFT_MIN_SESSIONS - 1), {}, now, 60 * DAY)).toEqual([]);
    expect(craftGoals(log, { farming: 0.9 }, now, 60 * DAY)).toEqual([]);
    expect(craftGoals([...log, entry(5, 50 * DAY)], {}, now, 60 * DAY)[0]?.id).toBe(
      "medium:craft:farming:0.25",
    );
  });

  it("sin alcanzar el hito no hay evidencia; alcanzado, solo sesiones posteriores a la meta", () => {
    const [g] = craftGoals(log, { farming: 0.1 }, now, 60 * DAY);
    if (!g) throw new Error("meta esperada");
    expect(craftEvidence(g, log, { farming: 0.2 }, now)).toEqual([]);
    const later = [entry(6, 41 * DAY), entry(7, 45 * DAY), entry(8, 50 * DAY)];
    const at = (60 * DAY) as Tick;
    const ev = craftEvidence(g, [...log, ...later], { farming: 0.3 }, at);
    expect(ev.map((e) => e.cause)).toEqual(later.map((e) => e.event));
    const done = goalCompletionsFromProgress([g], ev, at, new Set([g.id]), 2 * DAY);
    expect(done).toHaveLength(1);
    expect(done[0]?.cause).toBe(makeId("event", 8));
    // una sola sesión posterior no cierra la meta aunque el nivel ya alcanzó el hito
    const one = craftEvidence(g, [...log, later[0] as PracticeEntry], { farming: 0.3 }, at);
    expect(goalCompletionsFromProgress([g], one, at, new Set([g.id]), 0)).toEqual([]);
  });
});
