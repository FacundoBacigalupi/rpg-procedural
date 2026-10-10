import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type EntityBase,
  type Event,
  type EventId,
  makeId,
  type PlaceId,
  type PlaceRef,
  Rng,
} from "../../core/index.ts";
import {
  ENTITY,
  type Goal,
  LOCATION,
  type Location,
  type ProcessContext,
  type ProcessResult,
  type ReadonlyWorldTruth,
  WorldTruth,
} from "../../sim/index.ts";
import { optInParts } from "./create.ts";
import { GOAL_EVENT, NPC_GOALS, type NpcGoals } from "./decide.ts";
import { BODY_DIED_EVENT, goalDeathClosureProcess } from "./goal-death.ts";

const dead = makeId("agent", 1);
const site = { kind: "place", place: "place:1" as PlaceId } satisfies PlaceRef;
const origin1 = makeId("event", 1);
const origin2 = makeId("event", 2);

const goals: Goal[] = [
  {
    id: "core:family",
    layer: "core",
    kind: "pursue",
    value: "immortality",
    weight: 0.8,
    originEventId: origin1,
    since: 10,
  },
  {
    id: "core:avenge:agent:2",
    layer: "core",
    kind: "avenge",
    target: makeId("agent", 2),
    weight: 0.6,
    originEventId: origin2,
    since: 20,
  },
];

function world({
  endedAt,
  endEventId,
  items = goals,
}: {
  readonly endedAt?: number;
  readonly endEventId?: EventId;
  readonly items?: readonly Goal[];
} = {}) {
  const truth = new WorldTruth();
  truth.set(ENTITY, dead, {
    id: dead,
    originEventId: origin1,
    createdAt: 0,
    ...(endedAt === undefined ? {} : { endedAt }),
    ...(endEventId === undefined ? {} : { endEventId }),
  } satisfies EntityBase);
  truth.set(LOCATION, dead, { hex: 5, space: "room:1" } satisfies Location);
  truth.set(NPC_GOALS, dead, { items } satisfies NpcGoals);
  return truth;
}

function event({
  id = makeId("event", 10),
  actor = dead,
  kind = BODY_DIED_EVENT,
}: {
  readonly id?: EventId;
  readonly actor?: AgentId;
  readonly kind?: string;
} = {}): Event {
  return {
    id,
    tick: 100,
    kind,
    actors: [actor],
    place: site,
    data: { cause: "wound" },
    emissions: {},
    causes: [{ kind: "state", entity: actor, key: "body" }],
    resolution: "local",
  };
}

function context(truth: WorldTruth, recent: readonly Event[]): ProcessContext {
  return {
    now: 100,
    window: 0,
    windowIndex: undefined,
    scope: "world",
    resolution: "local",
    phase: "perceive",
    truth,
    ledger: undefined,
    rng: Rng.root(5),
    item: undefined,
    recent,
    newId() {
      throw new Error("cerrar objetivos no crea entidades");
    },
  };
}

function apply(truth: WorldTruth, out: ProcessResult) {
  for (const change of out.changes ?? []) {
    if (change.op === "delete") truth.deleteRaw(change.table, change.id);
    else if (change.op === "set") truth.setRaw(change.table, change.id, change.value);
  }
}

describe("life.goal-death", () => {
  const process = goalDeathClosureProcess({
    placeOf: (truth: ReadonlyWorldTruth, who) => {
      if (!truth.get(LOCATION, who)) throw new Error("el proceso debe leer la ubicación");
      return site;
    },
  });

  it("cierra todas las metas con causas de muerte, origen y estado, una sola vez", () => {
    const death = event();
    const truth = world({ endedAt: 100, endEventId: death.id });
    const out = process.run(context(truth, [death]));
    expect(out.events).toHaveLength(2);
    expect(out.events?.map((e) => ({ kind: e.kind, data: e.data, causes: e.causes }))).toEqual(
      goals.map((goal) => ({
        kind: GOAL_EVENT,
        data: {
          goal: goal.id,
          layer: goal.layer,
          what: "ended",
          weight: goal.weight,
          ...(goal.value === undefined ? {} : { value: goal.value }),
          ...(goal.target === undefined ? {} : { target: goal.target }),
        },
        causes: [
          { kind: "event", event: death.id },
          { kind: "event", event: goal.originEventId },
          { kind: "state", entity: dead, key: "goals" },
        ],
      })),
    );
    expect(out.changes).toEqual([{ op: "delete", table: NPC_GOALS.name, id: dead }]);
    apply(truth, out);
    expect(process.run(context(truth, [death]))).toEqual({});
  });

  it("ignora vivos, eventos que no terminan al actor, rumores y filas vacías", () => {
    const death = event();
    const alive = world({ endEventId: death.id });
    expect(process.run(context(alive, [death]))).toEqual({});

    const mismatch = world({ endedAt: 100, endEventId: makeId("event", 11) });
    expect(process.run(context(mismatch, [death]))).toEqual({});
    expect(
      process.run(context(mismatch, [event({ id: makeId("event", 12), kind: "rumor.told" })])),
    ).toEqual({});

    const empty = world({ endedAt: 100, endEventId: death.id, items: [] });
    expect(process.run(context(empty, [death]))).toEqual({});
  });

  it("declara el escritor de NPC_GOALS en perceive y el opt-in queda apagado por defecto", () => {
    expect(process.phase).toBe("perceive");
    expect(process.cadence).toEqual({ local: "onEvent", scene: "onEvent" });
    expect(process.reads).toContain(NPC_GOALS.name);
    expect(process.reads).toContain(ENTITY.name);
    expect(process.reads).toContain(LOCATION.name);
    expect(process.writes).toEqual([NPC_GOALS.name]);
    expect(optInParts({})).toEqual({});
    expect(optInParts({ closeGoalsOnDeath: false })).toEqual({});
    expect(optInParts({ closeGoalsOnDeath: true })).toEqual({ closeGoalsOnDeath: true });
  });
});
