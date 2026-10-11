import { describe, expect, it } from "vitest";
import type { AgentId, Event, EventId } from "../../core/index.ts";
import {
  DEBT_BOOK,
  type DebtBelief,
  defaultGameSetup,
  NPC_DECISION,
  NPC_GOALS,
  optionsOf,
} from "../../game/index.ts";
import { ENTITY, SCENARIOS, WorldTruth } from "../../sim/index.ts";
import { sampleGoalMetrics, summarizeGoalMetrics } from "./goal-metrics.ts";
import { goalMeasurementSetup, scenarioRun } from "./scenario.ts";

const A = "agent:1" as AgentId;
const B = "agent:2" as AgentId;
const E = "event:1" as EventId;
const event = (
  id: number,
  tick: number,
  kind: string,
  data: unknown,
  causes: Event["causes"] = [{ kind: "event", event: E }],
): Event =>
  ({
    id: `event:${id}` as EventId,
    tick,
    kind,
    data,
    actors: [A],
    causes,
    place: { kind: "cell", cell: 0 },
    resolution: "local",
    emissions: {},
  }) as unknown as Event;
const belief: DebtBelief = {
  commitment: "commitment:1",
  kind: "credit",
  role: "debtor",
  other: B,
  debtorRef: A,
  creditorRef: B,
  unit: "grain",
  total: 100,
  remaining: 50,
  status: "active",
  originEventId: E,
  learnedAt: 10,
  confidence: 0.5,
  sources: [E],
};

describe("medición opt-in de objetivos", () => {
  it("schema y setup pasan flags explícitos sin alterar default ni agregar opciones omitidas", () => {
    const setup = { game: defaultGameSetup("realistic"), frequency: 4 };
    expect(goalMeasurementSetup(setup, {})).toBe(setup);
    const s = SCENARIOS.schema.parse({
      id: "measure",
      name: "medición",
      description: "prueba",
      life: { persistGoalLayers: true, debtKnowledge: true },
    });
    expect(optionsOf(scenarioRun(s).setup)).toMatchObject({
      persistGoalLayers: true,
      debtKnowledge: true,
    });
    const off = goalMeasurementSetup(setup, { persistGoalLayers: false, debtKnowledge: false });
    expect(optionsOf(off)).toMatchObject({ persistGoalLayers: false, debtKnowledge: false });
    expect(() =>
      SCENARIOS.schema.parse({
        id: "bad",
        name: "bad",
        description: "bad",
        life: { debtKnowledge: 1 },
      }),
    ).toThrow();
    expect(() =>
      SCENARIOS.schema.parse({
        id: "bad",
        name: "bad",
        description: "bad",
        life: { unknown: true },
      }),
    ).toThrow();
  });

  it("cuenta decisiones nuevas, distingue exposición a deuda e ignora muertos/elecciones viejas", () => {
    const truth = new WorldTruth();
    truth.set(ENTITY, A, { originEventId: E } as never);
    truth.set(ENTITY, B, { originEventId: E, endedAt: 5 } as never);
    truth.set(DEBT_BOOK, A, {
      items: [
        belief,
        {
          ...belief,
          commitment: "commitment:2",
          unit: "silver",
          total: 1000,
          remaining: 1000,
          confidence: 1,
        },
        { ...belief, commitment: "commitment:3", role: "creditor" },
      ],
    });
    truth.set(NPC_DECISION, A, { at: 12, id: "gather", verb: "gather", utility: 0.7, options: 3 });
    truth.set(NPC_DECISION, B, { at: 12, id: "strike", verb: "strike", utility: 9, options: 2 });
    truth.set(NPC_GOALS, A, {
      items: [
        {
          id: "medium:debt:agent:2",
          layer: "medium",
          kind: "pursue",
          value: "justice",
          target: B,
          weight: 0.3,
          originEventId: E,
          since: 10,
        },
      ],
    });
    const events = [event(1, 1, "seed", {}, [])];
    const sample = sampleGoalMetrics(truth, events, 10, 20);
    expect(sample).toMatchObject({
      decisions: 1,
      byVerb: { gather: 1 },
      withDebtByVerb: { gather: 1 },
      bookHolders: 1,
      activeDebts: 2,
      ratioSum: 1.25,
      goalsByLayer: { medium: 1 },
      missingSources: 0,
      futureSources: 0,
    });
    expect(sampleGoalMetrics(truth, events, 20, 30).decisions).toBe(0);
    const result = summarizeGoalMetrics([sample], events, 10, 20);
    expect(result).toMatchObject({
      decisions: 1,
      meanUtility: 0.7,
      meanOptions: 3,
      finalMeanDebtRatio: 0.625,
    });
    expect(sampleGoalMetrics(truth, events, 0, 10).decisions).toBe(0);
  });

  it("audita fuentes y causas con ventana real, reporta invalidez sin introducir NaN/Infinity", () => {
    const truth = new WorldTruth();
    truth.set(ENTITY, A, { originEventId: E } as never);
    truth.set(DEBT_BOOK, A, {
      items: [
        { ...belief, confidence: Number.NaN },
        { ...belief, commitment: "commitment:2", sources: ["event:9" as EventId] },
      ],
    });
    const events = [
      event(1, 50, "seed", {}, []),
      event(2, 5, "npc.goal", { layer: "medium", what: "born" }),
      event(3, 20, "npc.goal", { layer: "medium", what: "born" }),
      event(4, 30, "npc.goal", { layer: "medium", what: "ended" }, []),
      event(5, 200, "npc.goal", { layer: "short", what: "born" }),
    ];
    const sample = sampleGoalMetrics(truth, events, 10, 100);
    expect(sample).toMatchObject({ invalidBeliefs: 1, missingSources: 1, futureSources: 2 });
    const result = summarizeGoalMetrics([sample], events, 10, 100);
    expect(result).toMatchObject({
      bornByLayer: { medium: 1 },
      endedByLayer: { medium: 1 },
      missingGoalCauses: 1,
      invalidGoalCauses: 1,
    });
    expect(JSON.stringify(result)).not.toContain("null");
    expect(summarizeGoalMetrics([], [], 0, 1)).toMatchObject({
      samples: 0,
      decisions: 0,
      meanUtility: 0,
      finalMeanDebtRatio: 0,
    });
  });
});
