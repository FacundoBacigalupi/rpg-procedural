import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AgentId, EventId, Tick } from "../../core/index.ts";
import {
  BODY_STATE,
  type Body,
  type InferenceRuleDef,
  infer,
  KNOWN_DEEDS,
  LOCATION,
  type Reasoner,
  TRACE,
  toRule,
  WorldTruth,
  type Wound,
} from "../../sim/index.ts";
import { headPremises, placeArg } from "./evidence.ts";

const ME = "agent:1" as AgentId;
const OTHER = "agent:2" as AgentId;
const FAR = "agent:3" as AgentId;
const defs = JSON.parse(readFileSync("content/inference/rules.json", "utf8")) as InferenceRuleDef[];
const rules = defs.map(toRule);
const who: Reasoner = {
  intellect: 0.9,
  rules: defs.map((d) => d.id),
  fatigue: 0,
  fear: 0,
  suspicion: 0,
};

const wound = (over: Partial<Wound> = {}): Wound =>
  ({
    id: 1,
    kind: "cut",
    zone: "arm",
    severity: 0.3,
    bleeding: 0,
    arterial: false,
    internal: 0,
    fracture: false,
    contamination: 0.1,
    infection: 0,
    virulence: 0,
    repair: 0,
    stage: "fresh",
    cleaned: false,
    ...over,
  }) as Wound;

function world(wounds: readonly Wound[] = []): WorldTruth {
  const t = new WorldTruth();
  t.set(LOCATION, ME, { hex: 5 });
  t.set(LOCATION, OTHER, { hex: 5 });
  t.set(LOCATION, FAR, { hex: 9 });
  t.set(BODY_STATE, OTHER, { wounds } as unknown as Body);
  t.set(BODY_STATE, FAR, { wounds: [wound()] } as unknown as Body);
  return t;
}

describe("premisas desde lo que tiene delante", () => {
  it("ve el corte limpio de quien está en el lugar, y no el del que está lejos", () => {
    const p = headPremises(world([wound()]), ME, 0 as Tick);
    expect(p.map((x) => x.fact.args[0])).toEqual([OTHER]);
    const c = infer(p, rules, who);
    expect(c.some((x) => x.fact.pred === "cut_by_blade")).toBe(true);
  });

  it("no ve lo interno ni lo sucio ni lo curado", () => {
    for (const w of [
      wound({ internal: 0.2 }),
      wound({ contamination: 0.9 }),
      wound({ stage: "healed" }),
      wound({ kind: "blunt" }),
    ]) {
      expect(headPremises(world([w]), ME, 0 as Tick)).toEqual([]);
    }
  });

  it("la huella se lee de alguien solo si el hecho que la dejó se sabe de quién fue", () => {
    const t = world();
    const trace = {
      kind: "blood" as const,
      at: { hex: 5 },
      made: 0 as Tick,
      by: [FAR],
      event: "event:7" as EventId,
      strength: 0.9,
    };
    t.set(TRACE, "trace:1" as never, trace);
    expect(headPremises(t, ME, 3600 as Tick)).toEqual([]);
    t.set(KNOWN_DEEDS, ME, {
      deeds: [
        {
          kind: "assault",
          by: OTHER,
          victim: FAR,
          event: "event:7" as EventId,
          at: 0 as Tick,
          via: "saw",
        },
      ],
    });
    const p = headPremises(t, ME, 3600 as Tick);
    expect(p.map((x) => x.fact.pred).sort()).toEqual(["tracks_fresh", "tracks_of"]);
    const c = infer(p, rules, who);
    const passed = c.find((x) => x.fact.pred === "passed_recently");
    expect(passed?.fact.args).toEqual([OTHER, placeArg({ hex: 5 })]);
  });

  it("la huella vieja ya no se lee como reciente", () => {
    const t = world();
    t.set(TRACE, "trace:1" as never, {
      kind: "blood",
      at: { hex: 5 },
      made: 0 as Tick,
      by: [FAR],
      event: "event:7" as EventId,
      strength: 0.9,
    });
    t.set(KNOWN_DEEDS, ME, {
      deeds: [
        {
          kind: "assault",
          by: OTHER,
          victim: FAR,
          event: "event:7" as EventId,
          at: 0 as Tick,
          via: "saw",
        },
      ],
    });
    const p = headPremises(t, ME, (36 * 3600) as Tick);
    expect(p.map((x) => x.fact.pred)).toEqual(["tracks_of"]);
  });
});
