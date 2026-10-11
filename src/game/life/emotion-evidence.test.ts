import { describe, expect, it } from "vitest";
import {
  type AgentId,
  EARTHLIKE_CLOCK,
  type Event,
  type EventId,
  makeId,
  Rng,
} from "../../core/index.ts";
import {
  appraiseGuilt,
  appraiseLoss,
  BODY_STATE,
  EMOTIONS,
  ENTITY,
  INNATE,
  LOCATION,
  MIND,
  PERSON,
  type Percept,
  type ProcessContext,
  RELATIONS,
  strangerDims,
  VILLAGE_SQUARE,
  villageSpaces,
  WorldTruth,
} from "../../sim/index.ts";
import { type AppraiseOptions, appraiseProcess } from "./appraise.ts";
import {
  ownEmotionSignals,
  perceivedEnvySignals,
  perceivedLossSignals,
  perceivedLoveSignals,
  receivedInsultSignals,
} from "./emotion-evidence.ts";
import { NPC_PERCEPTS, type WitnessingOptions, witnessingProcess } from "./witnessing.ts";

const OWNER = makeId("agent", 1) as AgentId;
const DEAD = makeId("agent", 2) as AgentId;
const THIRD = makeId("agent", 3) as AgentId;
const ORIGIN = makeId("event", 7) as EventId;
const now = EARTHLIKE_CLOCK.day / 2;
const event = (kind = "combat.fight"): Event => ({
  id: ORIGIN,
  tick: now,
  kind,
  actors: [DEAD, OWNER],
  place: { kind: "cell", cell: makeId("cell", 1) },
  data: { hits: [{ to: OWNER, severity: 1 }] },
  emissions: { sight: 10, sound: 10 },
  causes: [{ kind: "seed" }],
  resolution: "local",
});
const field = (value: unknown) => ({ value, confidence: 1, mistaken: false });
const percept: Percept = {
  id: "seen:death",
  observer: OWNER,
  sourceEventId: ORIGIN,
  tick: now,
  channels: ["sight"],
  detail: "identified",
  fields: { action: field("body.died"), identity: field(DEAD) },
};
const appraisal = [{ stimulus: { theme: "violence", intensity: 0.8 }, blame: DEAD }] as const;
const insultEvent = (): Event => ({
  ...event("action.speak"),
  actors: [OWNER, DEAD],
  data: {
    effect: {
      kind: "speak",
      to: DEAD,
      delivered: true,
      reply: "insult.hurt",
      regard: { kind: "insult", faceLoss: 0.7, deltas: { resentment: 0.3 } },
    },
  },
});

describe("evidencia propia de emociones", () => {
  it("la envidia sale de la vestimenta leída de alguien de rango mayor al propio y exige que importe el estatus", () => {
    const seen: Percept = {
      ...percept,
      fields: { attire: field("fine"), identity: field(DEAD) },
    };
    const ctx = {
      rankOfAttire: (a: string) => (a === "fine" ? 3 : 1),
      ownRank: 1,
      rankSpan: 4,
      valuesStatus: 0.8,
    };
    expect(perceivedEnvySignals(seen, now, ctx)[0]).toMatchObject({
      owner: OWNER,
      emotion: "envy",
      target: DEAD,
      intensity: 0.4,
      evidence: { kind: "percept", percept: percept.id },
    });
    for (const bad of [
      { valuesStatus: 0 },
      { ownRank: 3 },
      { ownRank: undefined },
      { rankSpan: 0 },
      { rankOfAttire: () => undefined },
    ])
      expect(perceivedEnvySignals(seen, now, { ...ctx, ...bad })).toEqual([]);
    expect(perceivedEnvySignals({ ...seen, fields: { attire: field("fine") } }, now, ctx)).toEqual(
      [],
    );
    expect(perceivedEnvySignals({ ...seen, tick: now + 1 }, now, ctx)).toEqual([]);
  });

  it("el amor nace de calidez vista de alguien con cariño previo, con la identidad leída", () => {
    const give: Percept = {
      ...percept,
      fields: { action: field("action.give"), identity: field(DEAD) },
    };
    const likes = (id: AgentId) => (id === DEAD ? 0.5 : 0);
    expect(perceivedLoveSignals(give, now, likes)[0]).toMatchObject({
      owner: OWNER,
      emotion: "love",
      target: DEAD,
      evidence: { kind: "percept", percept: percept.id },
    });
    expect(perceivedLoveSignals(give, now, () => 0)).toEqual([]);
    expect(perceivedLoveSignals(percept, now, () => 1)).toEqual([]);
    expect(
      perceivedLoveSignals({ ...give, fields: { action: field("action.give") } }, now, () => 1),
    ).toEqual([]);
    expect(perceivedLoveSignals({ ...give, tick: now + 1 }, now, () => 1)).toEqual([]);
  });

  it("la alegría exige éxito propio con evidencia de pelea del dueño como iniciador", () => {
    const win = [{ stimulus: { theme: "success", intensity: 0.4 }, blame: null }] as const;
    const mine = { ...event("combat.fight"), actors: [OWNER, DEAD] };
    expect(ownEmotionSignals(OWNER, mine, win, now, true)[0]).toMatchObject({
      emotion: "joy",
      intensity: 0.4,
      evidence: { kind: "own", event: ORIGIN },
    });
    expect(ownEmotionSignals(OWNER, mine, win, now, false)).toEqual([]);
    expect(ownEmotionSignals(DEAD, mine, win, now, true)).toEqual([]);
    expect(ownEmotionSignals(OWNER, event("action.speak"), win, now, true)).toEqual([]);
  });

  it("la ira toma el insulto entendido de converse, no intención cruda ni otra emoción del hablante", () => {
    expect(receivedInsultSignals(insultEvent(), now, true)[0]).toMatchObject({
      owner: OWNER,
      target: DEAD,
      emotion: "anger",
      intensity: 0.7,
      evidence: { kind: "own", event: ORIGIN },
    });
    expect(receivedInsultSignals(insultEvent(), now, false)).toEqual([]);
    expect(receivedInsultSignals(insultEvent(), now - 1, true)).toEqual([]);
    for (const effect of [
      {
        kind: "speak",
        to: DEAD,
        delivered: false,
        reply: "insult.hurt",
        regard: { kind: "insult", faceLoss: 0.7 },
      },
      { kind: "speak", to: DEAD, delivered: true, act: { kind: "insult" } },
      {
        kind: "speak",
        to: DEAD,
        delivered: true,
        reply: "other",
        regard: { kind: "insult", faceLoss: 0.7 },
      },
      {
        kind: "speak",
        to: DEAD,
        delivered: true,
        reply: "insult.hurt",
        regard: { kind: "flattery", faceLoss: 0.7 },
      },
    ])
      expect(receivedInsultSignals({ ...insultEvent(), data: { effect } }, now, true)).toEqual([]);
    expect(receivedInsultSignals({ ...insultEvent(), actors: [OWNER] }, now, true)).toEqual([]);
  });

  it("requiere violencia propia consciente y culpa de la acción propia, nunca pérdida legacy del hogar", () => {
    expect(ownEmotionSignals(OWNER, event(), appraisal, now, true)[0]).toMatchObject({
      emotion: "fear",
      evidence: { kind: "own", event: ORIGIN },
    });
    expect(ownEmotionSignals(THIRD, event(), appraisal, now, true)).toEqual([]);
    expect(ownEmotionSignals(OWNER, event(), appraisal, now, false)).toEqual([]);
    expect(ownEmotionSignals(OWNER, { ...event(), tick: now + 1 }, appraisal, now, true)).toEqual(
      [],
    );
    expect(ownEmotionSignals(OWNER, event("body.died"), appraiseLoss(1), now, true)).toEqual([]);
    const deed = { ...event("action.steal"), actors: [OWNER, DEAD] };
    expect(ownEmotionSignals(OWNER, deed, appraiseGuilt(0.8), now, true)[0]?.emotion).toBe("guilt");
    expect(ownEmotionSignals(DEAD, deed, appraiseGuilt(0.8), now, true)).toEqual([]);
  });
  it("la pérdida usa acción e identidad leídas y su relación propia, incluso si la identidad es errónea", () => {
    const close = (id: AgentId) => (id === THIRD ? 1 : 0);
    expect(perceivedLossSignals(percept, now, close)).toEqual([]);
    const mistaken = {
      ...percept,
      fields: { ...percept.fields, identity: { ...field(THIRD), mistaken: true } },
    };
    expect(perceivedLossSignals(mistaken, now, close)[0]).toMatchObject({
      owner: OWNER,
      emotion: "sadness",
      originEventId: ORIGIN,
      evidence: { kind: "percept", percept: percept.id },
    });
    expect(
      perceivedLossSignals({ ...percept, fields: { action: field("body.died") } }, now, () => 1),
    ).toEqual([]);
    expect(
      perceivedLossSignals({ ...percept, fields: { identity: field(DEAD) } }, now, () => 1),
    ).toEqual([]);
    const unsourced: Percept = {
      id: "no-source",
      observer: OWNER,
      tick: now,
      channels: ["sight"],
      detail: "identified",
      fields: percept.fields,
    };
    expect(perceivedLossSignals(unsourced, now, () => 1)).toEqual([]);
    expect(perceivedLossSignals(percept, now - 1, () => 1)).toEqual([]);
  });
});

const options: AppraiseOptions = {
  clock: EARTHLIKE_CLOCK,
  schemas: [],
  stages: [
    { id: "adult", name: "Adulto", species: "human", fromAge: 0, plasticity: 1, sensitive: [] },
  ],
  dims: [],
  bonds: [],
  habits: [],
  traits: [],
};
function world() {
  const truth = new WorldTruth();
  for (const id of [OWNER, DEAD]) {
    truth.set(ENTITY, id, { id, originEventId: makeId("event", 1), createdAt: 0 });
    truth.set(PERSON, id, {
      born: -30 * EARTHLIKE_CLOCK.year,
      household: "home:1",
      sex: "male",
    } as never);
    truth.set(BODY_STATE, id, { consciousness: "alert", activity: "rest", death: null } as never);
    truth.set(MIND, id, { schemas: {}, formative: [], originEventId: makeId("event", 1) });
    truth.set(INNATE, id, {});
    truth.set(LOCATION, id, { hex: 0, space: VILLAGE_SQUARE });
  }
  truth.set(RELATIONS, OWNER, {
    toward: {
      [DEAD]: {
        dims: { ...strangerDims([]), affection: 1, familiarity: 1, dependency: 1 },
        bonds: [],
        history: [],
        updated: now,
      },
    },
    originEventId: makeId("event", 1),
  });
  return truth;
}
const context = (truth: WorldTruth, recent: readonly Event[]): ProcessContext => ({
  truth,
  recent,
  now,
  window: 3600,
  scope: "world",
  rng: Rng.root(7),
  windowIndex: undefined,
  resolution: "local",
  phase: "perceive",
  ledger: undefined,
  item: undefined,
  newId() {
    throw new Error("emotion fixture must not create entities");
  },
});

describe("life.appraise persiste emociones opt-in", () => {
  it("persiste ira con autor sólo con flag y no altera las otras escrituras del diálogo", () => {
    const truth = world();
    const ctx = context(truth, [insultEvent()]);
    const off = appraiseProcess(options).run(ctx);
    expect(appraiseProcess({ ...options, persistEmotionSignals: false }).run(ctx)).toEqual(off);
    const on = appraiseProcess({ ...options, persistEmotionSignals: true }).run(ctx);
    expect(on.changes?.filter((c) => c.table !== EMOTIONS.name)).toEqual(off.changes);
    const emotion = on.changes?.find((c) => c.table === EMOTIONS.name && c.id === OWNER);
    expect(emotion?.op === "set" ? emotion.value : undefined).toMatchObject({
      signals: [{ emotion: "anger", target: DEAD, originEventId: ORIGIN }],
    });
    expect(on.changes?.some((c) => c.table === EMOTIONS.name && c.id === DEAD)).toBe(false);
    truth.set(BODY_STATE, OWNER, {
      consciousness: "unconscious",
      activity: "rest",
      death: null,
    } as never);
    expect(
      appraiseProcess({ ...options, persistEmotionSignals: true })
        .run(ctx)
        .changes?.some((c) => c.table === EMOTIONS.name) ?? false,
    ).toBe(false);
  });

  it("false equivale a omitir; persiste miedo propio sin renovar el evento y declara un solo escritor", () => {
    const truth = world();
    const ctx = context(truth, [event()]);
    const off = appraiseProcess(options).run(ctx);
    expect(appraiseProcess({ ...options, persistEmotionSignals: false }).run(ctx)).toEqual(off);
    const process = appraiseProcess({ ...options, persistEmotionSignals: true });
    expect(process.phase).toBe("perceive");
    expect(process.reads).toContain(EMOTIONS.name);
    expect(process.writes).toContain(EMOTIONS.name);
    const on = process.run(ctx);
    const emotion = on.changes?.find((c) => c.table === EMOTIONS.name);
    expect(emotion && emotion.op === "set" ? emotion.value : undefined).toMatchObject({
      signals: [{ owner: OWNER, emotion: "fear", originEventId: ORIGIN, at: now }],
    });
    if (emotion?.op === "set") truth.setRaw(emotion.table, emotion.id, emotion.value);
    expect(process.run(ctx).changes?.filter((c) => c.table === EMOTIONS.name)).toEqual([]);
    truth.set(BODY_STATE, OWNER, {
      consciousness: "unconscious",
      activity: "rest",
      death: null,
    } as never);
    expect(
      process
        .run(context(truth, [{ ...event(), id: makeId("event", 8) }]))
        .changes?.filter((c) => c.table === EMOTIONS.name),
    ).toEqual([]);
  });
  it("percibe pérdida fresca sin depender de una fila escrita en la misma fase ni del hogar real", () => {
    const truth = world();
    const witness: WitnessingOptions = {
      player: THIRD,
      seed: 7,
      clock: EARTHLIKE_CLOCK,
      statuses: [],
      tierOf: () => 3,
      spaces: villageSpaces({ hex: 0, households: [] }),
      map: {
        cell: makeId("cell", 1),
        lonDeg: 0,
        neighbors: [[]],
        crossSeconds: [60],
        forest: [false],
        climate: {
          cell: "cell:1",
          latDeg: 0,
          axialTiltDeg: 23,
          annualMeanC: 20,
          seasonalRangeC: 0,
          annualPrecipMm: 1000,
          windEast: 0,
          windNorth: 0,
        },
      },
    };
    truth.set(PERSON, DEAD, {
      born: -30 * EARTHLIKE_CLOCK.year,
      household: "home:other",
      sex: "male",
    } as never);
    const death = { ...event("body.died"), actors: [DEAD], data: null };
    const ctx = context(truth, [death]);
    const witnessed = witnessingProcess(witness).run(ctx);
    expect(truth.get(NPC_PERCEPTS, OWNER)).toBeUndefined();
    const result = appraiseProcess({ ...options, witness, persistEmotionSignals: true }).run(ctx);
    const emotion = result.changes?.find((c) => c.table === EMOTIONS.name && c.id === OWNER);
    expect(emotion && emotion.op === "set" ? emotion.value : undefined).toMatchObject({
      signals: [{ emotion: "sadness", originEventId: ORIGIN, evidence: { kind: "percept" } }],
    });
    const seen = witnessed.changes?.find((c) => c.table === NPC_PERCEPTS.name && c.id === OWNER);
    expect(seen?.op).toBe("set");
    truth.set(LOCATION, OWNER, { hex: 1, space: VILLAGE_SQUARE });
    expect(
      appraiseProcess({ ...options, witness, persistEmotionSignals: true })
        .run(ctx)
        .changes?.some((c) => c.table === EMOTIONS.name) ?? false,
    ).toBe(false);
  });
});
