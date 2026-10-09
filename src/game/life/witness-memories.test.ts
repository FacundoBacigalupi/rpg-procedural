import { describe, expect, it } from "vitest";
import type { AgentId, Event, EventId, PlaceRef } from "../../core/index.ts";
import type { Percept } from "../../sim/index.ts";
import { perceptClarity, WITNESS_ASLEEP_ENCODING, witnessLived } from "./memories.ts";

const A = "agent:1" as AgentId;
const B = "agent:2" as AgentId;
const C = "agent:3" as AgentId;
const PLACE = { kind: "none" } as unknown as PlaceRef;

const give: Event = {
  id: "event:1" as EventId,
  tick: 100,
  kind: "action.give",
  actors: [A],
  place: PLACE,
  data: { effect: { kind: "give", to: B, grams: 800 } },
  emissions: {},
  causes: [],
} as unknown as Event;

function percept(observer: AgentId, confidence: number, identified: boolean): Percept {
  return {
    id: `p:${observer}`,
    observer,
    sourceEventId: give.id,
    tick: 100,
    channels: ["sight"],
    detail: identified ? "identified" : "clear",
    fields: {
      presence: { value: true, confidence, mistaken: false },
      action: { value: "action.give", confidence, mistaken: false },
      identity: { value: identified ? A : null, confidence, mistaken: false },
    },
  } as Percept;
}

describe("memorias de testigos que no son parte", () => {
  it("el testigo guarda una memoria más tenue, con la claridad de lo que vio", () => {
    const out = witnessLived(give, [percept(C, 0.8, true)]);
    expect(out).toHaveLength(1);
    const x = out[0]?.experience;
    expect(out[0]?.who).toBe(C);
    expect(x?.source).toBe("witnessed");
    expect(x?.clarity).toBeCloseTo(0.8, 5);
    expect(x?.with).toContain(A);
    expect(x?.intensity ?? 1).toBeLessThan(0.5);
  });

  it("no reconoce a nadie si no lo identificó, y ve peor con poca luz o lejos", () => {
    const clear = witnessLived(give, [percept(C, 0.9, false)])[0]?.experience;
    expect(clear?.with).toEqual([]);
    expect(perceptClarity(percept(C, 0.3, true))).toBeLessThan(
      perceptClarity(percept(C, 0.9, true)),
    );
    expect(witnessLived(give, [percept(C, 0.05, false)])).toEqual([]);
  });

  it("las partes no cuentan como testigos y dormido se guarda menos", () => {
    const out = witnessLived(
      give,
      [percept(A, 0.9, true), percept(B, 0.9, true), percept(C, 0.9, true)],
      (id) => (id === C ? WITNESS_ASLEEP_ENCODING : 1),
    );
    expect(out.map((l) => l.who)).toEqual([C]);
    expect(out[0]?.experience.encoding).toBe(WITNESS_ASLEEP_ENCODING);
  });

  it("lo trivial no deja memoria", () => {
    const walk = { ...give, kind: "action.walk", data: null } as unknown as Event;
    expect(witnessLived(walk, [percept(C, 0.9, true)])).toEqual([]);
  });
});
