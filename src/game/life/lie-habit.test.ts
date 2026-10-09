import { describe, expect, it } from "vitest";
import type { AgentId, Event, EventId } from "../../core/index.ts";
import { type HabitDef, reinforceAll, weaken } from "../../sim/index.ts";
import { lieTold } from "./appraise.ts";

const LISTENER = "agent:1" as AgentId;
const LIAR = "agent:2" as AgentId;

const speak = (verdict: string, certain: boolean): Event =>
  ({
    id: "event:1" as EventId,
    kind: "action.speak",
    tick: 10,
    actors: [LISTENER, LIAR],
    data: { effect: { kind: "speak", judged: { verdict, certain } } },
  }) as unknown as Event;

const LYING: HabitDef = {
  id: "lying",
  species: "human",
  name: "Mentir",
  verbs: [],
  kinds: ["speak.lie"],
  gain: 0.2,
  halfLifeDays: 100,
  settledAt: 0.5,
};

describe("mentir como hábito", () => {
  it("la mentira creída y la descubierta con acierto cuentan; lo demás no", () => {
    expect(lieTold(speak("believed", false))).toEqual({ liar: LIAR, caught: false });
    expect(lieTold(speak("caught", true))).toEqual({ liar: LIAR, caught: true });
    expect(lieTold(speak("believed", true))).toBeNull();
    expect(lieTold(speak("caught", false))).toBeNull();
    expect(lieTold(speak("doubted", false))).toBeNull();
  });

  it("ser descubierto enfría el hábito de golpe, sin crearlo si no existía", () => {
    const id = "event:1" as EventId;
    let habits = reinforceAll(undefined, [LYING], 0, id).habits;
    habits = reinforceAll(habits, [LYING], 0, id).habits;
    const before = habits.holds["lying"]?.strength ?? 0;
    const after = weaken(habits, [LYING], 0, 0.5).holds["lying"]?.strength ?? 1;
    expect(after).toBeCloseTo(before * 0.5, 5);
    expect(weaken(undefined, [LYING], 0, 0.5).holds).toEqual({});
  });
});
