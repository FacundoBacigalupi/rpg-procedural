import { describe, expect, it } from "vitest";
import type { AgentId, Event, EventId, PlaceRef, Tick } from "../../core/index.ts";
import { type Lexicon, type ProphecyBeliefs, understand, utter } from "../../sim/index.ts";
import type { ToldProphecy } from "./converse.ts";
import { retellProphecy } from "./divine.ts";

const A = "agent:1" as AgentId;
const B = "agent:2" as AgentId;
const C = "agent:3" as AgentId;
const lex: Lexicon = { people: [{ id: C, names: ["Mara"] }], goods: [] };

describe("contar la profecía (understand)", () => {
  it("entiende qué anuncia y de quién", () => {
    expect(understand("Dicen que Mara llegará lejos", lex)).toEqual({
      kind: "prophesy",
      about: C,
      claim: "greatness",
    });
    expect(understand("El adivino dijo que morirás joven", lex)).toEqual({
      kind: "prophesy",
      about: "you",
      claim: "death",
    });
    expect(understand("Dicen que Mara murió", lex).kind).toBe("tell");
  });
});

function speakEvent(told: ToldProphecy): Event {
  return {
    id: 77 as unknown as EventId,
    tick: 500 as Tick,
    kind: "action.speak",
    actors: [B, A],
    place: "here" as unknown as PlaceRef,
    data: { effect: { kind: "speak", prophecy: told } },
    emissions: {},
    causes: [],
    resolution: "scene",
  } as unknown as Event;
}

describe("retellProphecy", () => {
  it("deja el salto en el linaje y en las creencias del oyente", () => {
    const root = utter(
      A,
      { kind: "ruin", subject: C, intensity: 0.5 },
      "bones",
      0.6,
      5 as unknown as EventId,
      10 as Tick,
    );
    const heard = {
      ...root,
      credence: 0.3,
      hops: 1,
      lineage: [{ from: A, to: B, at: 500 as Tick, event: 0 as unknown as EventId }],
    };
    const e = speakEvent({
      speaker: A,
      listener: B,
      verdict: "doubted",
      fresh: false,
      told: root,
      heard,
    });
    const out = retellProphecy(e, () => undefined);
    expect(out?.changes).toHaveLength(1);
    const items = (out?.changes[0] as unknown as { value: ProphecyBeliefs } | undefined)?.value
      .items;
    expect(items).toBeDefined();
    expect(items?.[0]?.lineage[0]?.event).toBe(77);
    expect(out?.events[0]?.causes).toEqual([{ kind: "event", event: 77 }]);
  });

  it("una profecía inventada nace con el evento y queda en quien la dijo", () => {
    const told = utter(
      A,
      { kind: "fortune", subject: B, intensity: 0.5 },
      "spoken",
      0.35,
      0 as unknown as EventId,
      500 as Tick,
    );
    const heard = {
      ...told,
      hops: 1,
      lineage: [{ from: A, to: B, at: 500 as Tick, event: 0 as unknown as EventId }],
    };
    const out = retellProphecy(
      speakEvent({ speaker: A, listener: B, verdict: "believed", fresh: true, told, heard }),
      () => undefined,
    );
    expect(out?.changes).toHaveLength(2);
    expect(out?.events[0]?.data).toMatchObject({ prophecy: "prophecy@77", fresh: true });
  });
});
