import { describe, expect, it } from "vitest";
import type { AgentId, Event } from "../../core/index.ts";
import { extendPledge, isPledgeOverdue, makePledge } from "../../sim/index.ts";
import { believedOwed, favorDoneIn, leakedIn, promisedIn } from "./pledges.ts";

const A = "agent:1" as AgentId;
const B = "agent:2" as AgentId;
const C = "agent:3" as AgentId;
const DAY = 86_400;

const ev = (kind: string, actors: AgentId[], data: unknown, outcome?: string): Event =>
  ({ id: "event:1", kind, actors, data, outcome, tick: 0, causes: [] }) as unknown as Event;

describe("términos de favor y de callar", () => {
  const favor = makePledge({
    promisor: A,
    promisee: B,
    term: { kind: "favor", what: "repair" },
    at: 0,
    weight: 0.4,
  });
  const silence = makePledge({
    promisor: A,
    promisee: B,
    term: { kind: "silence", about: C },
    at: 0,
    weight: 0.4,
  });

  it("el favor se cumple con el verbo prometido hacia el destinatario, y con éxito", () => {
    expect(favorDoneIn(ev("action.repair", [A, B], { verb: "repair" }, "success"), favor)).toBe(
      true,
    );
    expect(favorDoneIn(ev("action.repair", [A, B], { verb: "repair" }, "failure"), favor)).toBe(
      false,
    );
    expect(favorDoneIn(ev("action.repair", [A, C], { verb: "repair" }, "success"), favor)).toBe(
      false,
    );
    expect(favorDoneIn(ev("action.rest", [A, B], { verb: "rest" }, "success"), favor)).toBe(false);
    expect(favorDoneIn(ev("action.repair", [B, A], { verb: "repair" }, "success"), favor)).toBe(
      false,
    );
  });

  it("callar se rompe al soltar el secreto a otro, no al destinatario ni al esquivar", () => {
    const told = (listener: AgentId, outcome: string) =>
      ev("action.speak", [listener, A], { effect: { keep: { about: C, outcome } } });
    expect(leakedIn(told(C, "revealed"), silence)).toBe(true);
    expect(leakedIn(told(C, "partial"), silence)).toBe(true);
    expect(leakedIn(told(C, "evaded"), silence)).toBe(false);
    expect(leakedIn(told(B, "revealed"), silence)).toBe(false);
    expect(leakedIn(told(C, "revealed"), favor)).toBe(false);
  });

  it("pedir más tiempo mueve el plazo y cuenta la prórroga", () => {
    const now = 100 * DAY;
    const next = extendPledge(favor, now);
    expect(next.extensions).toBe(1);
    expect(isPledgeOverdue(next, now)).toBe(false);
    expect(isPledgeOverdue(next, now + 8 * DAY)).toBe(true);
  });
});

describe("falsos incumplimientos", () => {
  it("reclama solo si cree claramente más de lo prometido, y solo de dar", () => {
    const give = (grams: number) => ({ kind: "give" as const, unit: "good:grain" as never, grams });
    expect(believedOwed(give(900), 500)).toBe(900);
    expect(believedOwed(give(520), 500)).toBeNull();
    expect(believedOwed(give(300), 500)).toBeNull();
    expect(believedOwed({ kind: "favor", what: "repair" }, 500)).toBeNull();
    expect(believedOwed(undefined, 500)).toBeNull();
  });
});

describe("términos sueltos de una promesa dicha", () => {
  const said = (pledge: unknown) => ev("action.speak", [B, A], { effect: { pledge } });
  it("el múltiplo escala los gramos y los términos viajan", () => {
    const p = promisedIn(
      said({ good: "grain", grams: 1000, terms: { times: 2, dueDays: 90, precision: 0.75 } }),
    );
    expect(p?.grams).toBe(2000);
    expect(p?.terms).toEqual({ times: 2, dueDays: 90, precision: 0.75 });
  });
  it("sin términos queda como antes", () => {
    const p = promisedIn(said({ good: "grain", grams: 1000 }));
    expect(p?.grams).toBe(1000);
    expect(p?.terms).toBeUndefined();
  });
});
