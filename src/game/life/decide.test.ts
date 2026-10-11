import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  EARTHLIKE_CLOCK,
  type EventId,
  loadContent,
  type PlaceRef,
  Rng,
} from "../../core/index.ts";
import {
  ACTIONS,
  ActionCatalog,
  BELIEFS,
  BODY_PLANS,
  BODY_STATE,
  type BodyPlanDef,
  EMOTIONS,
  ENTITY,
  INNATE,
  LIFE_STAGES,
  LOCATION,
  MEMORIES,
  MIND,
  newBody,
  PERSON,
  PERSON_SUBSTANCE,
  PLACE,
  PLANS,
  type ProcessContext,
  type ProcessResult,
  RELATIONS,
  SCHEMAS,
  SELF_IMAGES,
  SKILLS,
  SkillCatalog,
  strangerDims,
  TRAITS,
  VALUES,
  WorldTruth,
} from "../../sim/index.ts";
import { DEBT_BOOK, type DebtBelief, observeDebt } from "./debtknowledge.ts";
import {
  DECIDED_EVENT,
  type DecideOptions,
  decideProcess,
  GOAL_EVENT,
  NPC_DECISION,
  NPC_GOAL_COMPLETIONS,
  NPC_GOALS,
} from "./decide.ts";
import { ownGoalProgress } from "./goal-evidence.ts";
import { COMMITMENTS } from "./loans.ts";
import { MOLD_RUMORS } from "./moldgossip.ts";
import { PRACTICE_LOG } from "./practice-log.ts";

const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const content = loadContent(
  [ACTIONS, PLANS, SKILLS, TRAITS, BODY_PLANS, VALUES, SCHEMAS, LIFE_STAGES],
  [
    { kind: "actions", file: "a.json", data: json("content/actions/core.json") },
    { kind: "skills", file: "s.json", data: json("content/skills/core.json") },
    { kind: "traits", file: "t.json", data: json("content/traits/human.json") },
    { kind: "plans", file: "p.json", data: json("content/plans/steal.json") },
    { kind: "body-plans", file: "b.json", data: json("content/body-plans/human.json") },
    { kind: "values", file: "v.json", data: json("content/values/human.json") },
    { kind: "schemas", file: "m.json", data: json("content/schemas/human.json") },
    { kind: "life-stages", file: "l.json", data: json("content/life-stages/human.json") },
  ],
);
const plan = content.all(BODY_PLANS)[0] as BodyPlanDef;
const catalog = new ActionCatalog(content.all(ACTIONS), content.all(PLANS));
const A = "agent:1" as AgentId;
const PLAYER = "agent:99" as AgentId;
const NONE = { kind: "none" } as unknown as PlaceRef;

const opts: DecideOptions = {
  clock: EARTHLIKE_CLOCK,
  catalog,
  skills: new SkillCatalog(content.all(SKILLS), content.all(ACTIONS)),
  traits: content.all(TRAITS),
  bodyPlans: [plan],
  values: content.all(VALUES),
  schemas: content.all(SCHEMAS),
  stages: content.all(LIFE_STAGES),
  dims: [],
  bonds: [],
  player: PLAYER,
  placeOf: () => NONE,
};

function world(water: number) {
  const truth = new WorldTruth();
  truth.set(ENTITY, A, { endedAt: undefined } as never);
  truth.set(PERSON, A, { born: 0, household: "h:1", sex: "male" } as never);
  truth.set(BODY_STATE, A, { ...newBody(plan, 60, 0), water });
  truth.set(MIND, A, { schemas: {}, formative: [], originEventId: "event:1" as EventId });
  truth.set(INNATE, A, {});
  return truth;
}

const ctx = (truth: WorldTruth, who: AgentId, now: number) =>
  ({
    scope: who,
    truth,
    now,
    window: 3600,
    rng: Rng.root(7),
  }) as unknown as ProcessContext;

function layeredWorld() {
  const truth = world(3);
  truth.set(MIND, A, {
    schemas: { family_first: { strength: 1, causes: ["event:7" as EventId] } },
    formative: [],
    originEventId: "event:1" as EventId,
  });
  truth.set(RELATIONS, A, {
    toward: {
      "agent:2": {
        dims: { ...strangerDims([]), resentment: 0.4, familiarity: 0.8 },
        bonds: [],
        history: [],
        updated: 1000,
      },
    },
    originEventId: "event:1" as EventId,
  } as never);
  truth.set(MEMORIES, A, {
    items: [
      {
        eventId: "event:8" as EventId,
        perceived: { kind: "action.insult", with: ["agent:2" as AgentId], place: NONE },
        source: "witnessed",
        at: 900,
        intensity: 0.5,
        valence: -0.5,
        confidence: 1,
        distortion: 0,
        salience: 1,
        measured: 1000,
        lastRecalled: 1000,
        recalls: 0,
      },
    ],
    gists: [],
  });
  return truth;
}

function applyGoals(truth: WorldTruth, out: ProcessResult) {
  for (const change of out.changes ?? []) {
    if (change.op === "set" && [NPC_GOALS.name, NPC_GOAL_COMPLETIONS.name].includes(change.table))
      truth.setRaw(change.table, change.id, change.value);
  }
}

const goalData = (event: { readonly data: unknown }) =>
  event.data as { readonly goal: string; readonly what: "born" | "ended" };

describe("life.decide", () => {
  it("speak con acto declarado (opt-in): suma el saludo a un conocido y la decisión conserva el acto", () => {
    const truth = layeredWorld();
    const run = (o: DecideOptions) =>
      decideProcess(o)
        .run(ctx(truth, A, 1000))
        .changes?.find((c) => c.table === NPC_DECISION.name);
    const value = (c: ReturnType<typeof run>) =>
      c?.op === "set" ? (c.value as { verb: string; id: string; act?: unknown }) : undefined;
    // Sin la opción la decisión no declara ningún acto.
    expect(value(run(opts))?.act).toBeUndefined();
    const on = value(
      run({
        ...opts,
        speakActs: { minFamiliarity: 0.3, quietSeconds: 0, weight: 100, chance: 1 },
      }),
    );
    expect(on).toMatchObject({ verb: "speak", id: "speak:agent:2", act: { kind: "greet" } });
  });

  it("hurto creído (opt-in): suma una candidata por bien que oyó que tiene un conocido", () => {
    const truth = layeredWorld();
    truth.set(MOLD_RUMORS, A, {
      items: [
        {
          rumor: { mold: "attr", about: "agent:2", attr: "has", value: "pan" },
          confidence: 0.9,
          hops: 1,
          heardAt: 900,
          teller: null,
        },
      ],
      told: [],
    } as never);
    const hints = { ...opts, moldHints: {} };
    const take = { minConfidence: 0.3, perDeed: 0.2, maxPenalty: 0.5 };
    const options = (o: DecideOptions) =>
      decideProcess(o)
        .run(ctx(truth, A, 1000))
        .changes?.find((c) => c.table === NPC_DECISION.name);
    const off = options(hints);
    const on = options({ ...hints, takeBelieved: take });
    const count = (c: typeof off) =>
      c?.op === "set" ? (c.value as { options: number }).options : 0;
    expect(count(on)).toBe(count(off) + 1);
  });

  it("miedo tipado propio con evidencia entra por máximo en la capa inmediata, sin sumar utilidad", () => {
    const truth = world(0);
    const signal = {
      owner: A,
      emotion: "fear" as const,
      intensity: 0.8,
      originEventId: "event:8" as EventId,
      at: 1000,
      appraisalTheme: "violence" as const,
    };
    truth.set(EMOTIONS, A, { signals: [signal] });
    const process = decideProcess({ ...opts, persistImmediateGoals: true });
    const legacy = process.run(ctx(truth, A, 1000));
    expect(legacy.events?.some((e) => goalData(e).goal === "immediate:fear")).toBe(false);
    truth.set(EMOTIONS, A, {
      signals: [{ ...signal, evidence: { kind: "own", event: signal.originEventId } }],
    });
    const off = decideProcess(opts).run(ctx(truth, A, 1000));
    const on = process.run(ctx(truth, A, 1000));
    expect(on.changes?.find((c) => c.table === NPC_DECISION.name)).toEqual(
      off.changes?.find((c) => c.table === NPC_DECISION.name),
    );
    applyGoals(truth, on);
    expect(truth.get(NPC_GOALS, A)?.items.find((g) => g.id === "immediate:fear")).toMatchObject({
      weight: 0.8,
      originEventId: "event:8",
    });
    expect(on.events?.find((e) => goalData(e).goal === "immediate:fear")?.causes).toEqual([
      { kind: "event", event: "event:8" },
      { kind: "state", entity: A, key: "emotions" },
    ]);
    truth.set(EMOTIONS, A, {
      signals: [
        { ...signal, owner: PLAYER, evidence: { kind: "own", event: signal.originEventId } },
      ],
    });
    applyGoals(truth, process.run(ctx(truth, A, 1100)));
    expect(truth.get(NPC_GOALS, A)?.items.some((g) => g.id === "immediate:fear")).toBe(false);
  });

  it("ansia de señal conocida persiste con causa propia y legacy no inventa origen", () => {
    const truth = world(0);
    const cue = {
      substance: "wine",
      kind: "place" as const,
      key: "hex:0",
      strength: 0.6,
      at: 1000,
    };
    truth.set(PERSON_SUBSTANCE, A, { held: [], at: 1000, cues: [cue] });
    const options = { ...opts, cravingCues: true, persistImmediateGoals: true };
    const legacy = decideProcess(options).run(ctx(truth, A, 1000));
    applyGoals(truth, legacy);
    expect(truth.get(NPC_GOALS, A)?.items.some((g) => g.id === "immediate:craving")).toBe(false);
    truth.set(PERSON_SUBSTANCE, A, {
      held: [],
      at: 1000,
      cues: [{ ...cue, originEventId: "event:9" as EventId }],
    });
    const off = decideProcess({ ...opts, cravingCues: true }).run(ctx(truth, A, 1000));
    const on = decideProcess(options).run(ctx(truth, A, 1000));
    expect(on.changes?.find((c) => c.table === NPC_DECISION.name)).toEqual(
      off.changes?.find((c) => c.table === NPC_DECISION.name),
    );
    applyGoals(truth, on);
    expect(truth.get(NPC_GOALS, A)?.items.find((g) => g.id === "immediate:craving")).toMatchObject({
      originEventId: "event:9",
    });
    expect(on.events?.find((e) => goalData(e).goal === "immediate:craving")?.causes).toEqual([
      { kind: "event", event: "event:9" },
      { kind: "state", entity: A, key: "body.substance" },
    ]);
    expect(decideProcess(options).reads).toEqual(
      expect.arrayContaining([PERSON_SUBSTANCE.name, "body.substance_kind"]),
    );
  });

  it("compañía inmediata nace de contacto propio recordado y se termina sin evidencia", () => {
    const truth = world(0);
    const who = "agent:2" as AgentId;
    truth.set(RELATIONS, A, {
      toward: {
        [who]: {
          dims: { ...strangerDims([]), affection: 1, familiarity: 1 },
          bonds: [],
          history: ["event:8" as EventId],
          updated: 1000,
        },
      },
      originEventId: "event:1" as EventId,
    });
    truth.set(MEMORIES, A, {
      items: [
        {
          eventId: "event:8" as EventId,
          perceived: { kind: "action.talk", with: [who], place: NONE },
          source: "witnessed",
          at: 1000,
          intensity: 0.8,
          valence: 0.8,
          confidence: 1,
          distortion: 0,
          salience: 1,
          measured: 1000,
          lastRecalled: 1000,
          recalls: 0,
        },
      ],
      gists: [],
    });
    const now = 1000 + 72 * 3600;
    const off = decideProcess(opts).run(ctx(truth, A, now));
    const p = decideProcess({ ...opts, persistImmediateGoals: true });
    const out = p.run(ctx(truth, A, now));
    expect(out.changes?.find((c) => c.table === NPC_DECISION.name)).toEqual(
      off.changes?.find((c) => c.table === NPC_DECISION.name),
    );
    applyGoals(truth, out);
    expect(truth.get(NPC_GOALS, A)?.items.find((g) => g.id === "immediate:social")).toMatchObject({
      weight: 1,
      originEventId: "event:8",
      since: now,
    });
    expect(out.events?.find((e) => goalData(e).goal === "immediate:social")?.causes).toEqual([
      { kind: "event", event: "event:8" },
      { kind: "state", entity: A, key: "memories" },
    ]);
    truth.set(MEMORIES, A, { items: [], gists: [] });
    const end = p.run(ctx(truth, A, now + 3600));
    expect(end.events?.find((e) => goalData(e).goal === "immediate:social")?.causes).toEqual([
      { kind: "event", event: "event:8" },
      { kind: "state", entity: A, key: "memories" },
      { kind: "state", entity: A, key: "goals" },
    ]);
  });

  it("la capa inmediata opt-in conserva la decisión y registra causas y cambios de peso", () => {
    const truth = layeredWorld();
    truth.set(ENTITY, A, { id: A, originEventId: "event:1" as EventId, createdAt: 0 });
    const off = decideProcess(opts).run(ctx(truth, A, 1000));
    expect(
      decideProcess({ ...opts, persistImmediateGoals: false }).run(ctx(truth, A, 1000)),
    ).toEqual(off);
    const p = decideProcess({ ...opts, persistImmediateGoals: true });
    const on = p.run(ctx(truth, A, 1000));
    expect(on.changes?.find((c) => c.table === NPC_DECISION.name)).toEqual(
      off.changes?.find((c) => c.table === NPC_DECISION.name),
    );
    applyGoals(truth, on);
    const thirst = truth.get(NPC_GOALS, A)?.items.find((g) => g.id === "immediate:thirst");
    expect(thirst).toMatchObject({ layer: "immediate", originEventId: "event:1", since: 1000 });
    expect(on.events?.find((e) => goalData(e).goal === "immediate:thirst")?.causes).toEqual([
      { kind: "event", event: "event:1" },
      { kind: "state", entity: A, key: "body" },
    ]);
    expect(p.run(ctx(truth, A, 1100)).events?.filter((e) => e.kind === GOAL_EVENT)).toEqual([]);
    truth.set(BODY_STATE, A, { ...newBody(plan, 60, 0), water: 2.5 });
    applyGoals(truth, p.run(ctx(truth, A, 1200)));
    expect(truth.get(NPC_GOALS, A)?.items.find((g) => g.id === "immediate:thirst")).toMatchObject({
      since: 1000,
      originEventId: "event:1",
    });
    expect(
      truth.get(NPC_GOALS, A)?.items.find((g) => g.id === "immediate:thirst")?.weight,
    ).not.toBe(thirst?.weight);
    truth.set(BODY_STATE, A, newBody(plan, 60, 0));
    const end = p.run(ctx(truth, A, 1300));
    expect(end.events?.find((e) => goalData(e).goal === "immediate:thirst")?.causes).toEqual([
      { kind: "event", event: "event:1" },
      { kind: "state", entity: A, key: "body" },
      { kind: "state", entity: A, key: "goals" },
    ]);
  });

  it("sin procedencia corporal no inventa un objetivo inmediato de sed", () => {
    const truth = world(3);
    const out = decideProcess({ ...opts, persistImmediateGoals: true }).run(ctx(truth, A, 1000));
    applyGoals(truth, out);
    expect(truth.get(NPC_GOALS, A)?.items.some((g) => g.layer === "immediate")).toBe(false);
  });

  it("solo su libro opt-in produce metas de deuda con origen, peso actualizado y fin conocido", () => {
    const truth = world(0);
    const bookItem: DebtBelief = {
      commitment: "commitment:1",
      role: "debtor",
      other: "agent:2" as AgentId,
      debtorRef: "h:1",
      creditorRef: "h:2",
      unit: "grain",
      total: 100,
      remaining: 100,
      dueDay: 10,
      status: "active",
      originEventId: "event:11" as EventId,
      learnedAt: 900,
      confidence: 1,
      sources: ["event:11" as EventId],
    };
    const options = { ...opts, persistGoalLayers: true };
    const on = decideProcess({ ...options, debtKnowledge: true });
    expect(on.reads).toContain(DEBT_BOOK.name);
    expect(decideProcess(options).reads).not.toContain(DEBT_BOOK.name);
    const debtEvent = (out: ProcessResult) =>
      out.events?.find((e) => e.kind === GOAL_EVENT && goalData(e).goal === "medium:debt:agent:2");
    truth.set(
      COMMITMENTS,
      bookItem.commitment as never,
      {
        status: "active",
        obligations: [{ debtor: "h:1", creditor: "h:2", duty: { qty: 100 }, performed: 0 }],
      } as never,
    );
    truth.set(DEBT_BOOK, PLAYER, { items: [bookItem] });
    expect(debtEvent(on.run(ctx(truth, A, 1000)))).toBeUndefined();
    truth.set(DEBT_BOOK, A, { items: [bookItem] });
    const off = decideProcess(options).run(ctx(truth, A, 1000));
    expect(decideProcess({ ...options, debtKnowledge: false }).run(ctx(truth, A, 1000))).toEqual(
      off,
    );
    expect(debtEvent(off)).toBeUndefined();
    const first = on.run(ctx(truth, A, 1000));
    applyGoals(truth, first);
    expect(debtEvent(first)).toMatchObject({
      data: { what: "born", weight: 0.6 },
      causes: [{ kind: "event", event: bookItem.originEventId }],
    });
    expect(truth.has(ENTITY, bookItem.other)).toBe(false);
    const debt = () => truth.get(NPC_GOALS, A)?.items.find((g) => g.id === "medium:debt:agent:2");
    expect(debt()).toMatchObject({
      target: bookItem.other,
      since: 1000,
      originEventId: bookItem.originEventId,
    });
    truth.set(
      COMMITMENTS,
      bookItem.commitment as never,
      { status: "fulfilled", obligations: [] } as never,
    );
    const unknownPayment = on.run(ctx(truth, A, 1100));
    expect(debtEvent(unknownPayment)).toBeUndefined();
    expect(debt()?.weight).toBe(0.6);
    truth.set(
      DEBT_BOOK,
      A,
      observeDebt(truth.get(DEBT_BOOK, A), {
        kind: "paid",
        commitment: bookItem.commitment,
        amount: 50,
        event: "event:12" as EventId,
        at: 1200,
        fulfilled: false,
      }),
    );
    const partial = on.run(ctx(truth, A, 1200));
    applyGoals(truth, partial);
    expect(debtEvent(partial)).toBeUndefined();
    expect(debt()).toMatchObject({
      weight: 0.3,
      since: 1000,
      originEventId: bookItem.originEventId,
    });
    truth.set(
      DEBT_BOOK,
      A,
      observeDebt(truth.get(DEBT_BOOK, A), {
        kind: "paid",
        commitment: bookItem.commitment,
        amount: 50,
        event: "event:13" as EventId,
        at: 1300,
        fulfilled: true,
      }),
    );
    const done = on.run(ctx(truth, A, 1300));
    applyGoals(truth, done);
    expect(debt()).toBeUndefined();
    expect(debtEvent(done)).toMatchObject({
      data: { what: "ended" },
      causes: [
        { kind: "event", event: bookItem.originEventId },
        { kind: "state", entity: A, key: "goals" },
      ],
    });
  });

  it("false equivale a omitir la persistencia; encenderla conserva la decisión y el RNG", () => {
    const truth = layeredWorld();
    const off = decideProcess(opts).run(ctx(truth, A, 1000));
    expect(decideProcess({ ...opts, persistGoalLayers: false }).run(ctx(truth, A, 1000))).toEqual(
      off,
    );
    const on = decideProcess({ ...opts, persistGoalLayers: true }).run(ctx(truth, A, 1000));
    const decision = (out: ProcessResult) =>
      out.changes?.find((c) => c.table === NPC_DECISION.name);
    expect(decision(on)).toEqual(decision(off));
    applyGoals(truth, on);
    expect(
      decision(decideProcess({ ...opts, persistGoalLayers: true }).run(ctx(truth, A, 1000))),
    ).toEqual(decision(off));
    expect(truth.get(NPC_GOALS, A)?.items.map((g) => g.layer)).toEqual(
      expect.arrayContaining(["core", "long", "medium", "short"]),
    );
  });

  it("las capas nacen una vez, actualizan su peso conservando origen y since y terminan con causas", () => {
    const truth = layeredWorld();
    const process = decideProcess({ ...opts, persistGoalLayers: true });
    const first = process.run(ctx(truth, A, 1000));
    applyGoals(truth, first);
    const initial = truth.get(NPC_GOALS, A)?.items ?? [];
    const ids = ["long:family", "medium:rival:agent:2", "short:thirst"];
    for (const id of ids) {
      const g = initial.find((g) => g.id === id);
      expect(g).toBeDefined();
      expect(g?.since).toBe(1000);
      const birth = first.events?.find((e) => e.kind === GOAL_EVENT && goalData(e).goal === id);
      expect(birth && goalData(birth).what).toBe("born");
      expect(birth?.causes).toEqual([{ kind: "event", event: g?.originEventId }]);
    }
    const repeat = process.run(ctx(truth, A, 1100));
    expect(repeat.events?.filter((e) => e.kind === GOAL_EVENT) ?? []).toEqual([]);
    expect(repeat.changes?.filter((c) => c.table === NPC_GOALS.name) ?? []).toEqual([]);
    truth.set(MIND, A, {
      schemas: { family_first: { strength: 0.7, causes: ["event:9" as EventId] } },
      formative: [],
      originEventId: "event:10" as EventId,
    });
    truth.set(BODY_STATE, A, { ...newBody(plan, 60, 0), water: 2.5 });
    truth.set(RELATIONS, A, {
      toward: {
        "agent:2": {
          dims: { ...strangerDims([]), resentment: 0.5, familiarity: 0.8 },
          bonds: [],
          history: [],
          updated: 1200,
        },
      },
      originEventId: "event:1" as EventId,
    } as never);
    const update = process.run(ctx(truth, A, 1200));
    applyGoals(truth, update);
    expect(update.events?.filter((e) => e.kind === GOAL_EVENT) ?? []).toEqual([]);
    for (const id of ids) {
      const was = initial.find((g) => g.id === id);
      const next = truth.get(NPC_GOALS, A)?.items.find((g) => g.id === id);
      expect(next?.weight).not.toBe(was?.weight);
      expect(next?.since).toBe(was?.since);
      expect(next?.originEventId).toBe(was?.originEventId);
      if (next?.layer === "long") expect(next.parent).toBe("core:family");
    }
    truth.set(MIND, A, { schemas: {}, formative: [], originEventId: "event:10" as EventId });
    truth.set(BODY_STATE, A, newBody(plan, 60, 0));
    truth.set(RELATIONS, A, { toward: {}, originEventId: "event:1" as EventId });
    const end = process.run(ctx(truth, A, 1300));
    applyGoals(truth, end);
    for (const id of ids) {
      expect(truth.get(NPC_GOALS, A)?.items.some((g) => g.id === id)).toBe(false);
      const event = end.events?.find((e) => e.kind === GOAL_EVENT && goalData(e).goal === id);
      expect(event && goalData(event).what).toBe("ended");
      expect(event?.causes).toEqual([
        { kind: "event", event: initial.find((g) => g.id === id)?.originEventId },
        { kind: "state", entity: A, key: "goals" },
      ]);
    }
    expect(
      process.run(ctx(truth, A, 1400)).events?.filter((e) => e.kind === GOAL_EVENT) ?? [],
    ).toEqual([]);
  });

  it("declara lo que lee y lo que escribe, en la fase decide", () => {
    const p = decideProcess(opts);
    expect(p.phase).toBe("decide");
    expect(p.writes).toEqual([NPC_DECISION.name, NPC_GOALS.name]);
    expect(p.reads).not.toContain(NPC_GOAL_COMPLETIONS.name);
    const enabled = decideProcess({ ...opts, recognizeGoalCompletion: true });
    expect(enabled.reads).toContain(NPC_GOAL_COMPLETIONS.name);
    expect(enabled.writes).toContain(NPC_GOAL_COMPLETIONS.name);
  });

  it("cierra una venganza por creencia propia, cita ambas causas y no la regenera", () => {
    const truth = layeredWorld();
    const target = "agent:2" as AgentId;
    const goal = {
      id: "core:avenge:agent:2",
      layer: "core",
      kind: "avenge",
      target,
      weight: 0.7,
      originEventId: "event:8" as EventId,
      since: 800,
    } as const;
    truth.set(NPC_GOALS, A, { items: [goal] });
    truth.set(BELIEFS, A, {
      items: [
        {
          prop: { kind: "attr", subject: target, attr: "alive" },
          value: false,
          confidence: 0.95,
          asOf: 900,
          learnedAt: 900,
          measured: 900,
          salience: 0.9,
          sources: [{ kind: "percept", percept: "death", tick: 900, event: "event:9" as EventId }],
        },
      ],
    } as never);
    const process = decideProcess({ ...opts, recognizeGoalCompletion: true });
    expect(
      decideProcess({ ...opts, recognizeGoalCompletion: false }).run(ctx(truth, A, 1000)),
    ).toEqual(decideProcess(opts).run(ctx(truth, A, 1000)));
    const first = process.run(ctx(truth, A, 1000));
    const end = first.events?.find((e) => e.kind === GOAL_EVENT && goalData(e).goal === goal.id);
    expect(end?.data).toMatchObject({ what: "ended", reason: "fulfilled" });
    expect(end?.causes).toEqual([
      { kind: "event", event: goal.originEventId },
      { kind: "event", event: "event:9" },
      { kind: "state", entity: A, key: "goals" },
    ]);
    applyGoals(truth, first);
    expect(truth.get(NPC_GOALS, A)?.items.some((item) => item.id === goal.id)).toBe(false);
    expect(process.run(ctx(truth, A, 1100)).events?.filter((e) => e.kind === GOAL_EVENT)).toEqual(
      [],
    );
  });

  it("permite otra instancia tras revisar vivo y cerrar una nueva muerte percibida", () => {
    const truth = layeredWorld();
    const target = "agent:2" as AgentId;
    const goal = {
      id: "core:avenge:agent:2",
      layer: "core",
      kind: "avenge",
      target,
      weight: 0.9,
      originEventId: "event:8" as EventId,
      since: 800,
    } as const;
    truth.set(NPC_GOALS, A, { items: [goal] });
    truth.set(RELATIONS, A, {
      toward: {
        [target]: {
          dims: { ...strangerDims([]), resentment: 1, familiarity: 0.8 },
          bonds: [],
          history: [],
          updated: 1000,
        },
      },
      originEventId: "event:1" as EventId,
    } as never);
    const belief = (value: boolean, event: string, at: number) => ({
      items: [
        {
          prop: { kind: "attr", subject: target, attr: "alive" },
          value,
          confidence: 0.99,
          asOf: at,
          learnedAt: at,
          measured: at,
          salience: 1,
          sources: [{ kind: "percept", percept: "life", tick: at, event: event as EventId }],
        },
      ],
    });
    const process = decideProcess({ ...opts, recognizeGoalCompletion: true });
    truth.set(BELIEFS, A, belief(false, "event:9", 900) as never);
    const first = process.run(ctx(truth, A, 1000));
    applyGoals(truth, first);
    expect(truth.get(NPC_GOAL_COMPLETIONS, A)?.items).toHaveLength(1);

    truth.set(BELIEFS, A, belief(true, "event:10", 1100) as never);
    truth.set(RELATIONS, A, {
      toward: {
        [target]: {
          dims: { ...strangerDims([]), resentment: 1, familiarity: 0.8 },
          bonds: [],
          history: [],
          updated: 1100,
        },
      },
      originEventId: "event:1" as EventId,
    } as never);
    const reopened = process.run(ctx(truth, A, 1200));
    applyGoals(truth, reopened);
    const newGoal = truth.get(NPC_GOALS, A)?.items.find((item) => item.id === goal.id);
    expect(newGoal?.since).toBe(1200);
    expect(truth.get(NPC_GOAL_COMPLETIONS, A)?.items).toHaveLength(1);

    truth.set(BELIEFS, A, belief(false, "event:11", 1300) as never);
    const finishedAgain = process.run(ctx(truth, A, 1400));
    applyGoals(truth, finishedAgain);
    expect(
      finishedAgain.events?.filter(
        (event) => event.kind === GOAL_EVENT && goalData(event).goal === goal.id,
      ),
    ).toHaveLength(1);
    expect(truth.get(NPC_GOAL_COMPLETIONS, A)?.items).toHaveLength(2);
  });

  it("no atribuye una memoria ambigua de muerte a cada participante", () => {
    const truth = layeredWorld();
    const target = "agent:2" as AgentId;
    const goal = {
      id: "core:avenge:agent:2",
      layer: "core",
      kind: "avenge",
      target,
      weight: 0.7,
      originEventId: "event:8" as EventId,
      since: 800,
    } as const;
    truth.set(NPC_GOALS, A, { items: [goal] });
    truth.set(BELIEFS, A, {
      items: [
        {
          prop: { kind: "attr", subject: target, attr: "alive" },
          value: false,
          confidence: 0.95,
          asOf: 900,
          learnedAt: 900,
          measured: 900,
          salience: 0.9,
          sources: [{ kind: "told", from: PLAYER, tick: 900 }],
        },
      ],
    } as never);
    const memory = truth.get(MEMORIES, A)?.items[0];
    if (!memory) throw new Error("fixture memory missing");
    truth.set(MEMORIES, A, {
      items: [
        {
          ...memory,
          eventId: "event:12" as EventId,
          at: 900,
          measured: 900,
          perceived: { ...memory.perceived, kind: "body.died", with: [target, PLAYER] },
        },
      ],
      gists: [],
    });
    const process = decideProcess({ ...opts, recognizeGoalCompletion: true });
    const ambiguous = process.run(ctx(truth, A, 1000));
    expect(
      ambiguous.events?.some(
        (event) =>
          event.kind === GOAL_EVENT &&
          goalData(event).goal === goal.id &&
          (event.data as { reason?: string }).reason === "fulfilled",
      ),
    ).toBe(false);

    const deathMemory = truth.get(MEMORIES, A)?.items[0];
    if (!deathMemory) throw new Error("fixture memory missing");
    truth.set(MEMORIES, A, {
      items: [
        {
          ...deathMemory,
          perceived: { ...deathMemory.perceived, with: [target] },
        },
      ],
      gists: [],
    });
    const identified = process.run(ctx(truth, A, 1001));
    expect(
      identified.events?.find(
        (event) => event.kind === GOAL_EVENT && goalData(event).goal === goal.id,
      )?.causes,
    ).toContainEqual({ kind: "event", event: "event:12" });
  });

  it("el vacío de una venganza cumplida presiona meaning solo con la opción", () => {
    const year = 365 * 86_400;
    const make = (newCore?: "before" | "after") => {
      const truth = layeredWorld();
      if (newCore) {
        truth.set(NPC_GOALS, A, {
          items: [
            {
              id: "core:avenge:agent:3",
              layer: "core",
              kind: "avenge",
              target: "agent:3" as AgentId,
              weight: 0.6,
              originEventId: "event:20" as EventId,
              since: newCore === "after" ? year + 10 : 50,
            },
          ],
        });
      }
      // En un campo, `work` es posible y es el verbo que sirve meaning.
      truth.set(LOCATION, A, { hex: 5 });
      truth.set(PLACE, "place:1" as never, { kind: "fields", hexes: [5] });
      truth.set(NPC_GOAL_COMPLETIONS, A, {
        items: [
          {
            goalId: "core:avenge:agent:2",
            cause: "event:9" as EventId,
            at: year,
            original: {
              id: "core:avenge:agent:2",
              layer: "core",
              kind: "avenge",
              target: "agent:2" as AgentId,
              weight: 0.8,
              originEventId: "event:8" as EventId,
              since: 100,
            },
          },
        ],
      });
      return truth;
    };
    const base = decideProcess({ ...opts, recognizeGoalCompletion: true });
    const on = decideProcess({ ...opts, recognizeGoalCompletion: true, meaningPressure: true });
    expect(on.reads).toContain(NPC_GOAL_COMPLETIONS.name);
    expect(on.run(ctx(make(), A, 1000))).toEqual(on.run(ctx(make(), A, 1000)));
    const verbs = (p: typeof on, newCore?: "before" | "after") =>
      Array.from({ length: 60 }, (_, k) => {
        const change = p
          .run(ctx(make(newCore), A, 2 * year + k * 86_400))
          .changes?.find((c) => c.table === NPC_DECISION.name) as
          | { value?: { verb: string } }
          | undefined;
        return change?.value?.verb ?? "";
      });
    const off = verbs(decideProcess({ ...opts, meaningPressure: false }));
    expect(off).toEqual(verbs(base));
    const withMeaning = verbs(on);
    const works = (list: string[]) => list.filter((v) => v === "work").length;
    expect(works(withMeaning)).toBeGreaterThan(works(off));
    expect(withMeaning).not.toEqual(off);

    // Un núcleo nuevo, con causa, reemplaza el sentido: la presión se apaga. Uno anterior al
    // cumplimiento ya ocupaba el lugar y tampoco deja nacer el vacío.
    const offWithCore = (c: "before" | "after") =>
      verbs(decideProcess({ ...opts, meaningPressure: false }), c);
    expect(verbs(on, "after")).toEqual(offWithCore("after"));
    expect(verbs(on, "before")).toEqual(offWithCore("before"));
  });

  it("deriva una meta de oficio de la práctica propia y la cierra al alcanzar el hito (opt-in)", () => {
    const truth = layeredWorld();
    const entry = (n: number, at: number) => ({
      skill: "farming",
      event: `event:${n}` as EventId,
      at,
      hours: 2,
    });
    const image = (level: number) =>
      ({ farming: { estimate: { level, spread: 0.1 }, updated: 0 } }) as never;
    truth.set(PRACTICE_LOG, A, { items: [entry(30, 100), entry(31, 200), entry(32, 300)] });
    truth.set(SELF_IMAGES, A, image(0.1));
    const process = decideProcess({
      ...opts,
      persistGoalLayers: true,
      craftGoals: { window: 10_000 },
      goalProgress: ownGoalProgress(100),
    });
    const goalId = "medium:craft:farming:0.25";
    const first = process.run(ctx(truth, A, 1000));
    expect(
      first.events?.some(
        (e) => e.kind === GOAL_EVENT && goalData(e).goal === goalId && goalData(e).what === "born",
      ),
    ).toBe(true);
    applyGoals(truth, first);
    expect(truth.get(NPC_GOALS, A)?.items.find((g) => g.id === goalId)?.originEventId).toBe(
      "event:30",
    );

    // Sin llegar al hito, aunque siga practicando, no se cumple.
    truth.set(PRACTICE_LOG, A, {
      items: [entry(30, 100), entry(31, 200), entry(32, 300), entry(33, 1100), entry(34, 1200)],
    });
    const early = process.run(ctx(truth, A, 2000));
    expect(early.events?.some((e) => (e.data as { reason?: string }).reason === "fulfilled")).toBe(
      false,
    );
    // Con el hito alcanzado y tres sesiones posteriores a la meta, se cumple citando la última.
    truth.set(SELF_IMAGES, A, image(0.3));
    truth.set(PRACTICE_LOG, A, {
      items: [entry(30, 100), entry(33, 1100), entry(34, 1200), entry(35, 1300)],
    });
    const done = process.run(ctx(truth, A, 2000));
    const end = done.events?.find(
      (e) => e.kind === GOAL_EVENT && (e.data as { reason?: string }).reason === "fulfilled",
    );
    expect(goalData(end ?? { data: {} }).goal).toBe(goalId);
    expect(end?.causes).toContainEqual({ kind: "event", event: "event:35" });
  });

  it("cierra una meta concreta solo con progreso propio repetido y lo cita (opt-in)", () => {
    const truth = layeredWorld();
    const goal = {
      id: "medium:master_craft",
      layer: "medium",
      kind: "pursue",
      value: "knowledge",
      weight: 0.5,
      originEventId: "event:8" as EventId,
      since: 100,
    } as const;
    truth.set(NPC_GOALS, A, { items: [goal] });
    const evidence = (n: number) => ({
      goalId: goal.id,
      cause: `event:${n}` as EventId,
      at: 100 + n * 100,
      amount: 0.5,
    });
    let seen = [evidence(1)];
    const process = decideProcess({
      ...opts,
      persistGoalLayers: true,
      goalProgress: {
        concrete: (g) => g.id === goal.id,
        evidenceOf: () => seen,
        minSpan: 100,
      },
    });
    const fulfilled = (out: ReturnType<typeof process.run>) =>
      out.events?.find(
        (e) =>
          e.kind === GOAL_EVENT &&
          goalData(e).goal === goal.id &&
          (e.data as { reason?: string }).reason === "fulfilled",
      );
    expect(fulfilled(process.run(ctx(truth, A, 1000)))).toBeUndefined();
    expect(truth.get(NPC_GOAL_COMPLETIONS, A)).toBeUndefined();

    seen = [evidence(1), evidence(2), evidence(3)];
    const first = process.run(ctx(truth, A, 1000));
    expect(fulfilled(first)?.causes).toContainEqual({ kind: "event", event: "event:3" });
    applyGoals(truth, first);
    expect(truth.get(NPC_GOAL_COMPLETIONS, A)?.items).toHaveLength(1);
    expect(truth.get(NPC_GOALS, A)?.items.some((g) => g.id === goal.id)).toBe(false);
  });

  it("un NPC sediento registra su decisión y la emite una sola vez", () => {
    const p = decideProcess(opts);
    const truth = world(0.5);
    const out = p.run(ctx(truth, A, 1000)) as unknown as {
      changes?: unknown[];
      events?: { kind: string }[];
    };
    expect(out.changes?.length ?? 0).toBeGreaterThan(0);
    expect(out.events?.some((e) => e.kind === DECIDED_EVENT)).toBe(true);
  });

  it("un valor fuerte nace como objetivo con causa y se guarda una sola vez", () => {
    const p = decideProcess(opts);
    const truth = world(0.5);
    truth.set(MIND, A, {
      schemas: { family_first: { strength: 1, causes: ["event:7" as EventId] } },
      formative: [],
      originEventId: "event:1" as EventId,
    } as never);
    const out = p.run(ctx(truth, A, 1000)) as unknown as {
      changes?: { table?: string }[];
      events?: { kind: string; causes: { event?: string }[] }[];
    };
    const goal = out.events?.find((e) => e.kind === GOAL_EVENT);
    expect(goal?.causes[0]?.event).toBe("event:7");
    expect(JSON.stringify(out.changes)).toContain(NPC_GOALS.name);
  });

  it("con boilThirst, un sediento sin agua tratada considera hervir; apagado no", () => {
    const thirsty = world(0.05);
    const on = decideProcess({ ...opts, boilThirst: { minThirst: 0.1, weight: 1 } });
    const out = on.run(ctx(thirsty, A, 1000)) as unknown as {
      events?: { kind: string; data: { verb?: string } }[];
    };
    const decided = out.events?.find((e) => e.kind === DECIDED_EVENT);
    expect(on.reads).toContain("body.treated_water");
    expect(decided?.data.verb).toBeDefined();
    expect(decideProcess(opts).reads).not.toContain("body.treated_water");
  });

  it("el personaje del jugador no decide", () => {
    const p = decideProcess(opts);
    expect(p.run(ctx(world(0), PLAYER, 1000))).toEqual({});
  });
});
