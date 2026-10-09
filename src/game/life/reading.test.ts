import { describe, expect, it } from "vitest";
import { type AgentId, type Event, type EventId, makeId, Rng } from "../../core/index.ts";
import { COMMUNITY_CULTURE, MIND, PERSON_CULTURE, WorldTruth } from "../../sim/index.ts";
import { ASCRIBED_GROUPS } from "./identity.ts";
import { purposeContextOf, purposeReaderOf, readWitnessed, rememberReads } from "./reading.ts";

const agent = (n: number) => makeId("agent", n) as AgentId;

function event(purpose?: { motive: "gift" | "theft" }): Event {
  return {
    id: makeId("event", 1) as EventId,
    tick: 10,
    kind: "action.take",
    actors: [agent(1), agent(2)],
    data: { verb: "take", manner: ["covert"], ...(purpose ? { purpose } : {}) },
  } as unknown as Event;
}

describe("lectura del porqué del testigo", () => {
  it("el contexto sale del evento: a escondidas y contra el lector", () => {
    const ctx = purposeContextOf(event(), agent(2));
    expect(ctx).toMatchObject({ verb: "take", covert: true, onPerson: true, readerIsTarget: true });
  });

  it("sin porqué en el evento no hay lectura; con porqué sí, y es determinista", () => {
    const truth = new WorldTruth();
    expect(readWitnessed(Rng.root(1), truth, agent(2), event())).toBeUndefined();
    const a = readWitnessed(Rng.root(1), truth, agent(2), event({ motive: "gift" }));
    const b = readWitnessed(Rng.root(1), truth, agent(2), event({ motive: "gift" }));
    expect(a).toBeDefined();
    expect(a).toEqual(b);
  });

  it("la sospecha sube con el esquema de desconfianza", () => {
    const truth = new WorldTruth();
    const calm = purposeReaderOf(truth, agent(2), agent(1), 10);
    truth.set(MIND, agent(2), {
      schemas: { people_are_untrustworthy: { strength: 0.9 } },
      formative: [],
      originEventId: makeId("event", 9),
    } as never);
    const wary = purposeReaderOf(truth, agent(2), agent(1), 10);
    expect(wary.suspicion).toBeGreaterThan(calm.suspicion);
  });

  it("el grupo que cree que es el actor mueve el aprecio y la sospecha del lector", () => {
    const truth = new WorldTruth();
    const origin = makeId("event", 9) as EventId;
    truth.set(
      COMMUNITY_CULTURE,
      "aldea" as never,
      {
        culture: "village",
        name: "aldea",
        prevalence: { dress: { variants: { wool: 1 } } },
        originEventId: origin,
      } as never,
    );
    truth.set(PERSON_CULTURE, agent(2), {
      holdings: { dress: { variant: "wool", shown: "wool" } },
      identity: [],
      originEventId: origin,
    } as never);
    truth.set(MIND, agent(2), {
      schemas: { people_are_untrustworthy: { strength: 0.5 } },
      formative: [],
      originEventId: origin,
    } as never);
    const neutral = purposeReaderOf(truth, agent(2), agent(1), 10);
    const belief = (group: string) => ({
      about: {
        [agent(1)]: {
          holder: agent(2),
          about: agent(1),
          group,
          confidence: 0.9,
          basis: ["markers"],
        },
      },
    });
    truth.set(ASCRIBED_GROUPS, agent(2), belief("village") as never);
    const kin = purposeReaderOf(truth, agent(2), agent(1), 10);
    truth.set(ASCRIBED_GROUPS, agent(2), belief("far") as never);
    const stranger = purposeReaderOf(truth, agent(2), agent(1), 10);
    expect(kin.regard).toBeGreaterThan(neutral.regard);
    expect(kin.suspicion).toBeLessThan(neutral.suspicion);
    expect(stranger.regard).toBeLessThan(neutral.regard);
    expect(stranger.suspicion).toBeGreaterThan(neutral.suspicion);
  });

  it("guarda las últimas lecturas con tope", () => {
    const truth = new WorldTruth();
    const r = readWitnessed(Rng.root(1), truth, agent(2), event({ motive: "theft" }));
    if (!r) throw new Error("sin lectura");
    const many = rememberReads(
      truth,
      agent(2),
      Array.from({ length: 30 }, () => r),
    );
    expect(many.recent).toHaveLength(20);
  });
});
