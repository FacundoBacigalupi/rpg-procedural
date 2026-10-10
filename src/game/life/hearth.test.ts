import { describe, expect, it } from "vitest";
import { hearthEnv, hearthProcess } from "./hearth.ts";

const clock = { day: 86400, year: 86400 * 360, moons: [] };

describe("life.hearth", () => {
  it("es un proceso diario de la física que solo escribe HEARTH", () => {
    const p = hearthProcess({ clock, placeOf: () => ({ kind: "cell", cell: "cell:1" }) as never });
    expect(p.id).toBe("life.hearth");
    expect(p.phase).toBe("physics");
    expect(p.writes).toEqual(["body.hearth"]);
  });

  it("sin fuegos no cambia el ambiente", () => {
    const env = { airC: 0, windMs: 1, humidity: 0.5, wet: 0, shelter: 1, radiantC: 0 };
    const truth = { get: () => undefined, ids: () => [] } as never;
    expect(hearthEnv({ spaces: [] } as never)(truth, "agent:1" as never, env)).toBe(env);
  });
});
