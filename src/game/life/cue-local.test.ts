import { describe, expect, it } from "vitest";
import type { AgentId, EntityRef, PlanetClock } from "../../core/index.ts";
import { BELIEFS, LOCATION, WorldTruth } from "../../sim/index.ts";
import { cueLocalOf } from "./cue-local.ts";
import { cueContextOf } from "./substances.ts";

const clock = { day: 24000 } as unknown as PlanetClock;
const me = "agent:1" as AgentId;
const at = (subject: string, hex: number, asOf: number) => ({
  prop: { kind: "attr", subject, attr: "at" },
  value: { hex },
  confidence: 1,
  asOf,
  learnedAt: asOf,
  sources: [],
  salience: 1,
  measured: asOf,
});

describe("life.cueLocalOf", () => {
  const t = new WorldTruth();
  t.set(LOCATION, me as unknown as EntityRef, { hex: 5 } as never);
  // Verdad: agent:2 está en el hex, agent:3 no; el personaje cree lo contrario.
  t.set(LOCATION, "agent:2" as unknown as EntityRef, { hex: 5 } as never);
  t.set(LOCATION, "agent:3" as unknown as EntityRef, { hex: 9 } as never);
  t.set(
    BELIEFS,
    me as unknown as EntityRef,
    {
      items: [at("agent:3", 5, 1000), at("agent:2", 9, 1000)],
    } as never,
  );

  it("cree presente a quien cree en el hex y hora por longitud", () => {
    const l = cueLocalOf(t, me, 1000, clock, -120);
    expect(l.believedPresent).toEqual(["agent:3"]);
    expect(l.hourOffset).toBe(-8);
    expect(cueContextOf(t, me, 6000, clock, l).hour).toBe(22);
  });

  it("sin opt-in el entorno sigue siendo el de la verdad", () => {
    expect(cueContextOf(t, me, 6000, clock).people).toEqual(["agent:2"]);
  });
});
