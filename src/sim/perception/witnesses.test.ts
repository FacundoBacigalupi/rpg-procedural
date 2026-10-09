import { describe, expect, it } from "vitest";
import { type AgentId, type EventId, makeId, Rng } from "../../core/index.ts";
import { VILLAGE_SQUARE, villageSpaces } from "../world/index.ts";
import {
  ATTENTION,
  actionStimulus,
  type Medium,
  type Observer,
  pickWitnesses,
  sensorAcuity,
  type WitnessCandidate,
  witnessStimulus,
} from "./index.ts";

const agent = (n: number) => makeId("agent", n) as AgentId;
const ACTOR = agent(1);

const medium: Medium = {
  graph: villageSpaces({ hex: 0, households: [] }),
  forest: [false, false],
  daylight: 1,
};

function cand(n: number, tier: 0 | 1 | 2 | 3 | 4, hex = 0): WitnessCandidate {
  const observer: Observer = {
    id: agent(n),
    at: { hex, space: VILLAGE_SQUARE },
    acuity: sensorAcuity(30),
    attention: ATTENTION.alert,
    familiar: new Map([[ACTOR, 1]]),
  };
  return { observer, tier };
}

const stimulus = actionStimulus({
  event: "evt:1" as EventId,
  tick: 100,
  actor: ACTOR,
  at: { hex: 0, space: VILLAGE_SQUARE },
  look: { sex: "male", ageYears: 30 },
  verb: "action.work",
  emissions: { sight: 1, sound: 0.5 },
});

describe("testigos de un evento", () => {
  it("elige solo tier 2+ del mismo hex, con tope y orden estable", () => {
    const all = [cand(9, 2), cand(3, 3), cand(2, 1), cand(4, 2, 5), cand(5, 2), cand(6, 4)];
    const picked = pickWitnesses(stimulus, all, 3).map((w) => w.observer.id);
    expect(picked).toEqual([agent(6), agent(3), agent(5)]);
    expect(pickWitnesses(stimulus, [...all].reverse(), 3).map((w) => w.observer.id)).toEqual(
      picked,
    );
  });

  it("es determinista y el tier 2 pierde la figura que el tier 3 conserva", () => {
    const all = [cand(2, 2), cand(3, 3)];
    const a = witnessStimulus(stimulus, all, medium, Rng.root(7).fork("w"));
    const b = witnessStimulus(stimulus, all, medium, Rng.root(7).fork("w"));
    expect(a).toEqual(b);
    for (const p of a) {
      if (p.observer === agent(2)) expect(p.fields.figure).toBeUndefined();
    }
  });
});
