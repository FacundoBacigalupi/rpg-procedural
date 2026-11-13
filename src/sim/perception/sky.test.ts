import { describe, expect, it } from "vitest";
import { type AgentId, type EventId, Rng, type Tick } from "../../core/index.ts";
import type { Observer } from "./percept.ts";
import { hexesAround, SKY_SIGHT_KM, skyChance, skyPercepts, skyRadius } from "./sky.ts";

const observer = (id: string, attention = 1): Observer => ({
  id: id as AgentId,
  at: { hex: 0 },
  acuity: { sight: 1, sound: 1 },
  attention,
  familiar: new Map(),
});

describe("prodigios en el cielo (novel2-trib-far-sight)", () => {
  it("los hexes alrededor salen por los vecinos, sin el de la fuente", () => {
    // Una línea 0-1-2-3-4.
    const line = [[1], [0, 2], [1, 3], [2, 4], [3]];
    expect([...hexesAround(line, 2, 1)]).toEqual([
      [1, 1],
      [3, 1],
    ]);
    expect(hexesAround(line, 0, 3)).toEqual(
      new Map([
        [1, 1],
        [2, 2],
        [3, 3],
      ]),
    );
    expect(skyRadius(2)).toBe(SKY_SIGHT_KM / 2);
  });

  it("la chance cae con la distancia y la atención, y no pasa del alcance", () => {
    expect(skyChance(2, 1, 1)).toBeGreaterThan(skyChance(8, 1, 1));
    expect(skyChance(2, 1, 1)).toBeGreaterThan(skyChance(2, 1, 0.05));
    expect(skyChance(SKY_SIGHT_KM + 1, 1, 1)).toBe(0);
  });

  it("de lejos llega que hay algo y qué es, nunca quién; es determinista", () => {
    const source = {
      event: "e:1" as EventId,
      tick: 10 as Tick,
      verb: "heaven.tribulation_gathers",
    };
    const obs = [
      { observer: observer("agent:b"), hexes: 1 },
      { observer: observer("agent:a"), hexes: 2 },
      { observer: observer("agent:c", 0.01), hexes: 6 },
    ];
    const a = skyPercepts(source, obs, 2, Rng.root(7));
    const b = skyPercepts(source, [...obs].reverse(), 2, Rng.root(7));
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
    for (const p of a) {
      expect(p.detail).toBe("vague");
      expect(Object.keys(p.fields).sort()).toEqual(["action", "presence"]);
      expect(p.fields.action?.value).toBe(source.verb);
    }
    expect(a.some((p) => (p.observer as string) === "agent:c")).toBe(false);
  });
});
