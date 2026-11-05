import { describe, expect, it } from "vitest";
import type { AgentId, Event, EventId } from "../../core/index.ts";
import type { Memory } from "../../sim/index.ts";
import { STRETCH_MEANWHILE, stretchOf } from "./stretch.ts";

const me = "agent:1" as AgentId;
const other = "agent:2" as AgentId;
const ev = (id: number, kind: string, tick: number, actor: AgentId = me): Event =>
  ({ id: `event:${id}` as EventId, kind, tick, actors: [actor], causes: [] }) as unknown as Event;
const mem = (id: number, kind: string, at: number, intensity: number, told = false): Memory =>
  ({
    eventId: `event:${id}` as EventId,
    perceived: { kind, with: [other], place: { kind: "hex", hex: 0 } },
    source: told ? "told" : "witnessed",
    ...(told ? { toldBy: other } : {}),
    at,
    intensity,
    valence: 0,
    confidence: 1,
    distortion: 0,
    salience: 1,
    measured: at,
    lastRecalled: at,
    recalls: 0,
  }) as unknown as Memory;

describe("qué pasó mientras (novel-montage-while)", () => {
  it("cuenta la rutina propia del salto, lo recordado por peso y la estación nueva", () => {
    const events = [
      ev(1, "routine.harvested", 5),
      ev(2, "routine.harvested", 15),
      ev(3, "routine.ate", 16),
      ev(4, "routine.harvested", 1), // antes del salto
      ev(5, "routine.ate", 17, other), // de otro
    ];
    const memories = [
      mem(10, "action.give", 12, 0.3),
      mem(11, "body.died", 14, 0.5, true),
      mem(12, "routine.ate", 13, 0.9), // lo suyo no es noticia
      mem(13, "body.died", 2, 0.9), // antes del salto
    ];
    const s = stretchOf([], events, me, 4, 40, 10, [], {
      memories,
      seasons: { from: "winter", to: "spring" },
    });
    expect(s.kept).toEqual([
      { kind: "harvested", times: 2 },
      { kind: "ate", times: 1 },
    ]);
    expect(s.meanwhile?.map((m) => m.kind)).toEqual(["body.died", "action.give"]);
    expect(s.meanwhile?.[0]).toMatchObject({ source: "told", toldBy: other, with: [other] });
    expect(s.season).toBe("spring");
  });

  it("sin rutina, memorias ni cambio de estación no agrega nada; el tope corta lo de menos peso", () => {
    const plain = stretchOf([], [], me, 0, 40, 10, [], {
      seasons: { from: "summer", to: "summer" },
    });
    expect(plain.kept).toBeUndefined();
    expect(plain.meanwhile).toBeUndefined();
    expect(plain.season).toBeUndefined();
    const many = Array.from({ length: STRETCH_MEANWHILE + 3 }, (_, i) =>
      mem(i, "action.give", 10, i / 10),
    );
    const capped = stretchOf([], [], me, 0, 40, 10, [], { memories: many });
    expect(capped.meanwhile).toHaveLength(STRETCH_MEANWHILE);
    expect(capped.meanwhile?.at(-1)).toBeDefined();
  });
});
