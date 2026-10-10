import { describe, expect, it } from "vitest";
import type { AgentId, Event, EventId, PlaceRef } from "../../core/index.ts";
import { addMemory, formMemory, type Memories } from "../../sim/index.ts";
import {
  applyTalkMemory,
  applyTestimony,
  recountOf,
  recountTone,
  rumorToldMemory,
  talkMemoryIn,
  weighedMemories,
} from "./talkmemory.ts";

const A = "agent:1" as AgentId;
const B = "agent:2" as AgentId;
const C = "agent:3" as AgentId;
const PLACE = { kind: "none" } as unknown as PlaceRef;
const mem = (id: string, who: AgentId, valence: number, intensity = 0.6) =>
  formMemory({
    eventId: id as EventId,
    kind: "action.give",
    with: [who],
    place: PLACE,
    at: 100,
    intensity,
    valence,
  });
const hold = (...ms: ReturnType<typeof mem>[]): Memories =>
  ms.reduce<Memories | undefined>((acc, m) => addMemory(acc, m, 100), undefined) as Memories;

describe("la charla y la memoria", () => {
  it("pesan las memorias salientes de quien habla, no las de otros", () => {
    const m = hold(mem("event:1", B, 0.5), mem("event:2", C, 0.5), mem("event:3", B, -0.5, 0.9));
    expect(weighedMemories(m, B, 100)).toEqual(["event:3", "event:1"]);
    expect(weighedMemories(undefined, B, 100)).toEqual([]);
  });

  it("cuenta lo que recuerda, o lo niega por rencor o por doloroso con poca honestidad", () => {
    const sweet = hold(mem("event:1", C, 0.6));
    const sour = hold(mem("event:2", C, -0.7));
    const honest = { honesty: 0.8, grudge: false };
    expect(recountOf(sweet, C, 100, honest)?.denied).toBe(false);
    expect(recountOf(sweet, C, 100, { ...honest, grudge: true })?.denied).toBe(true);
    expect(recountOf(sour, C, 100, honest)?.denied).toBe(false);
    expect(recountOf(sour, C, 100, { honesty: 0.2, grudge: false })?.denied).toBe(true);
    expect(recountOf(sweet, B, 100, honest)).toBeNull();
    expect(recountTone(0.6)).toBe("good");
    expect(recountTone(-0.6)).toBe("bad");
    expect(recountTone(0)).toBe("plain");
  });

  it("conversar refuerza lo recordado y lo contado queda como memoria told", () => {
    const listener = hold(mem("event:1", C, 0.6));
    const r = recountOf(listener, C, 100, { honesty: 0.8, grudge: false });
    if (!r) throw new Error("debía recordar");
    const later = 100 + 20 * 86_400;
    const out = applyTalkMemory(
      listener,
      undefined,
      { recalled: ["event:1"], recounted: r },
      { teller: A, place: PLACE, now: later },
    );
    expect(out.listener?.items[0]?.recalls).toBe(1);
    const told = out.asker?.items[0];
    expect(told?.source).toBe("told");
    expect(told?.toldBy).toBe(A);
    expect(told?.eventId).toBe("event:1");
    expect(told?.intensity ?? 1).toBeLessThanOrEqual(0.5);
    // Lo negado no deja memoria en quien preguntó, pero igual se pensó.
    const denied = applyTalkMemory(
      listener,
      undefined,
      { recounted: { ...r, denied: true } },
      { teller: A, place: PLACE, now: later },
    );
    expect(denied.asker).toBeUndefined();
    expect(denied.listener?.items[0]?.recalls).toBe(1);
  });

  it("lee el efecto del action.speak", () => {
    const e = {
      data: { effect: { kind: "speak", recalled: ["event:1"] } },
    } as unknown as Event;
    expect(talkMemoryIn(e)?.recalled).toEqual(["event:1"]);
    expect(talkMemoryIn({ data: { effect: { kind: "speak" } } } as unknown as Event)).toBeNull();
  });

  it("declarar lo refuerza, y declarar una versión falsa lo corre hacia lo dicho", () => {
    const base = hold(mem("event:1", B, -0.5));
    const m: Memories = { ...base, items: base.items.map((x) => ({ ...x, confidence: 0.5 })) };
    const honest = applyTestimony(
      m,
      { deed: "event:1" as EventId, said: true, lie: "none", accused: null },
      200,
    );
    expect(honest?.items[0]?.recalls).toBe(1);
    expect(honest?.items[0]?.confidence).toBeGreaterThan(m.items[0]?.confidence ?? 1);
    const framed = applyTestimony(
      m,
      { deed: "event:1" as EventId, said: true, lie: "frame", accused: C },
      200,
    );
    expect(framed?.items[0]?.distortion).toBeGreaterThan(0);
    expect(framed?.items[0]?.perceived.with).toEqual([C]);
    const denied = applyTestimony(
      m,
      { deed: "event:1" as EventId, said: false, lie: "deny", accused: null },
      200,
    );
    expect(denied?.items[0]?.perceived.with).toEqual([B]);
    expect(denied?.items[0]?.distortion).toBe(0);
    expect(
      applyTestimony(m, { deed: "event:9" as EventId, said: true, lie: "frame", accused: C }, 200),
    ).toBe(m);
  });
});

describe("la memoria del rumor que cuenta el personaje", () => {
  const told = (data: Record<string, unknown>): Event =>
    ({
      id: "event:9",
      kind: "rumor.told",
      tick: 200,
      actors: [A, B],
      place: PLACE,
      data: { deed: "event:5", kind: "theft", accused: C, victim: A, byCharacter: true, ...data },
    }) as unknown as Event;

  it("forma una memoria told del hecho con el personaje como fuente", () => {
    const r = rumorToldMemory(told({ credit: 0.7 }), undefined);
    expect(r?.who).toBe(B);
    expect(r?.memory.source).toBe("told");
    expect(r?.memory.toldBy).toBe(A);
    expect(r?.memory.eventId).toBe("event:5");
    expect(r?.memory.perceived.with).toEqual([C, A]);
  });

  it("nada si no lo creyó, si ya lo recordaba o si no viene del personaje", () => {
    expect(rumorToldMemory(told({ credit: 0.05 }), undefined)).toBeNull();
    expect(rumorToldMemory(told({ credit: 0.7 }), hold(mem("event:5", C, -0.3)))).toBeNull();
    expect(rumorToldMemory(told({ credit: 0.7, byCharacter: false }), undefined)).toBeNull();
  });
});
