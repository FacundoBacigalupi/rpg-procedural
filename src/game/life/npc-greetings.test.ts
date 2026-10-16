import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type EntityBase,
  type EventId,
  makeId,
  type PlaceId,
  type PlaceRef,
  Rng,
} from "../../core/index.ts";
import {
  ENTITY,
  LOCATION,
  PERSON,
  type ProcessContext,
  type ProcessResult,
  RELATIONS,
  WorldTruth,
} from "../../sim/index.ts";
import { NPC_MET } from "./npc-encounters.ts";
import {
  GREET_CHANCE,
  GREET_FAMILIARITY,
  GREETED_EVENT,
  type GreetingSpeech,
  NPC_GREETED,
  npcGreetingsProcess,
} from "./npc-greetings.ts";
import { NPC_JOURNEY } from "./npc-verbs.ts";

const me = makeId("agent", 1);
const other = makeId("agent", 2);
const player = makeId("agent", 99);
const site = { kind: "place", place: "place:1" as PlaceId } satisfies PlaceRef;
const dims = [
  { id: "familiarity", name: "familiaridad", baseline: 0, halfLifeDays: 30 },
  { id: "resentment", name: "rencor", baseline: 0, halfLifeDays: 30 },
  { id: "fear", name: "miedo", baseline: 0, halfLifeDays: 30 },
  { id: "affection", name: "afecto", baseline: 0, halfLifeDays: 30 },
  { id: "trust", name: "confianza", baseline: 0, halfLifeDays: 30 },
] as const;
const origin = makeId("event", 1) as EventId;

function world(opts: { otherHex?: number; met?: boolean; resentment?: number } = {}) {
  const truth = new WorldTruth();
  const base = (id: AgentId): EntityBase => ({ id, originEventId: origin, createdAt: 0 });
  for (const id of [me, other]) {
    truth.set(ENTITY, id, base(id));
    truth.set(PERSON, id, {} as never);
    truth.set(LOCATION, id, { hex: id === me ? 5 : (opts.otherHex ?? 5) });
  }
  truth.set(NPC_JOURNEY, me, { place: "place:7", since: 100, decision: "d" });
  if (opts.met !== false) truth.set(NPC_MET, me, { since: 100, met: [other] });
  if (opts.resentment) {
    const zero = { familiarity: 0, resentment: opts.resentment, fear: 0, affection: 0, trust: 0 };
    truth.set(RELATIONS, other, {
      originEventId: origin,
      toward: { [me]: { dims: zero as never, bonds: [], history: [], updated: 0 } },
    });
  }
  return truth;
}

function run(truth: WorldTruth, now = 3600, seed = 1, speech?: GreetingSpeech): ProcessResult {
  return npcGreetingsProcess({
    player,
    dims: [...dims],
    bonds: [],
    placeOf: () => site,
    ...(speech ? { speech } : {}),
  }).run({
    now,
    window: 3600,
    windowIndex: 1,
    scope: "world",
    resolution: "local",
    phase: "physics",
    truth,
    ledger: undefined,
    rng: Rng.root(seed),
    item: undefined,
    recent: [],
    newId() {
      throw new Error("no crea entidades");
    },
  } as unknown as ProcessContext);
}

function apply(truth: WorldTruth, out: ProcessResult) {
  for (const c of out.changes ?? []) {
    if (c.op === "delete") truth.deleteRaw(c.table, c.id);
    else if (c.op === "set") truth.setRaw(c.table, c.id, c.value);
  }
}

function greetingTime(): number {
  for (let h = 1; h < 200; h++) {
    if (run(world(), h * 3600).events?.length) return h * 3600;
  }
  throw new Error("nunca saluda");
}

describe("life.npc_greetings", () => {
  it("se saludan y queda familiaridad, afecto y confianza a ambos lados", () => {
    const truth = world();
    const out = run(truth, greetingTime());
    expect(out.events?.[0]).toMatchObject({
      kind: GREETED_EVENT,
      actors: [me, other],
      data: { hex: 5, form: "gesture" },
    });
    apply(truth, out);
    for (const [a, b] of [
      [me, other],
      [other, me],
    ] as const) {
      const d = truth.get(RELATIONS, a)?.toward[b]?.dims;
      expect(d?.familiarity).toBeCloseTo(GREET_FAMILIARITY, 5);
      expect(d?.affection).toBeGreaterThan(0);
      expect(d?.trust).toBeGreaterThan(0);
    }
    expect(truth.get(NPC_GREETED, me)?.greeted).toEqual([other]);
  });

  it("una sola vez por pareja y viaje", () => {
    const truth = world();
    const now = greetingTime();
    apply(truth, run(truth, now));
    for (let h = 1; h < 50; h++) expect(run(truth, now + h * 3600).events ?? []).toEqual([]);
  });

  it("sin cruce, en otro hex o con rencor no saluda", () => {
    for (let h = 1; h < 60; h++) {
      expect(run(world({ met: false }), h * 3600)).toEqual({});
      expect(run(world({ otherHex: 6 }), h * 3600)).toEqual({});
      expect(run(world({ resentment: 0.8 }), h * 3600)).toEqual({});
    }
  });

  it("con familiaridad previa cruzan palabras", () => {
    const truth = world();
    truth.set(RELATIONS, me, {
      originEventId: origin,
      toward: {
        [other]: {
          dims: { familiarity: 0.5, resentment: 0, fear: 0, affection: 0, trust: 0 } as never,
          bonds: [],
          history: [],
          updated: 3600,
        },
      },
    });
    const out = run(truth, greetingTime());
    expect(out.events?.[0]?.data).toMatchObject({ form: "words" });
  });

  it("es determinista y saluda cerca de GREET_CHANCE de las veces", () => {
    let n = 0;
    const total = 400;
    for (let h = 1; h <= total; h++) {
      const a = run(world(), h * 3600);
      expect(run(world(), h * 3600)).toEqual(a);
      if (a.events?.length) n++;
    }
    expect(Math.abs(n / total - GREET_CHANCE)).toBeLessThan(0.1);
  });

  it("viaje terminado limpia la libreta", () => {
    const truth = world();
    apply(truth, run(truth, greetingTime()));
    truth.deleteRaw(NPC_JOURNEY.name, me);
    apply(truth, run(truth));
    expect(truth.get(NPC_GREETED, me)).toBeUndefined();
  });
});

describe("el saludo como acto de habla", () => {
  const lexicon = { people: [], goods: [] };
  const known = (): WorldTruth => {
    const truth = world();
    truth.set(RELATIONS, me, {
      originEventId: origin,
      toward: {
        [other]: {
          dims: { familiarity: 0.5, resentment: 0, fear: 0, affection: 0, trust: 0 } as never,
          bonds: [],
          history: [],
          updated: 3600,
        },
      },
    });
    return truth;
  };
  const timeFor = (speech: GreetingSpeech): number => {
    for (let h = 1; h < 200; h++) {
      if (run(known(), h * 3600, 1, speech).events?.length) return h * 3600;
    }
    throw new Error("nunca saluda");
  };

  it("entendido, deja lo mismo que el efecto directo y anota quién entendió", () => {
    const speech: GreetingSpeech = { say: () => "Buenas", lexicon };
    const now = timeFor(speech);
    const direct = known();
    apply(direct, run(direct, now));
    const spoken = known();
    const out = run(spoken, now, 1, speech);
    apply(spoken, out);
    expect(out.events?.[0]?.data).toMatchObject({
      form: "words",
      understood: { [me]: true, [other]: true },
    });
    expect(spoken.get(RELATIONS, me)).toEqual(direct.get(RELATIONS, me));
    expect(spoken.get(RELATIONS, other)).toEqual(direct.get(RELATIONS, other));
  });

  it("lo que no se entiende como saludo no entibia a quien lo oyó", () => {
    const speech: GreetingSpeech = { say: (s) => (s === me ? "Buenas" : "mmm"), lexicon };
    const truth = known();
    const out = run(truth, timeFor(speech), 1, speech);
    expect(out.events?.[0]?.data).toMatchObject({ understood: { [me]: false, [other]: true } });
    apply(truth, out);
    // `me` oyó "mmm" de `other`: su sentir por él no cambia; `other` sí oyó el saludo de `me`.
    expect(truth.get(RELATIONS, me)?.toward[other]?.dims.familiarity).toBeCloseTo(0.5, 5);
    expect(truth.get(RELATIONS, other)?.toward[me]?.dims.familiarity).toBeGreaterThan(0);
  });

  it("el gesto no necesita lengua, es determinista y apagado no cambia nada", () => {
    const deaf: GreetingSpeech = { say: () => "mmm", lexicon };
    const now = greetingTime();
    const out = run(world(), now, 1, deaf);
    expect(out.events?.[0]?.data).toEqual({ hex: 5, form: "gesture" });
    expect(run(world(), now, 1, deaf)).toEqual(out);
    expect(out).toEqual(run(world(), now));
  });

  it("con claridad por debajo del mínimo nadie entiende, aunque el texto sea un saludo", () => {
    const speech: GreetingSpeech = { say: () => "Buenas", lexicon, clarity: () => 0 };
    const truth = known();
    const out = run(truth, timeFor(speech), 1, speech);
    expect(out.events?.[0]?.data).toMatchObject({ understood: { [me]: false, [other]: false } });
    apply(truth, out);
    expect(truth.get(RELATIONS, me)?.toward[other]?.dims.familiarity).toBeCloseTo(0.5, 5);
    expect(truth.get(RELATIONS, other)).toBeUndefined();
  });

  it("sin lengua en común, el saludo cae a un gesto que se entiende y entibia", () => {
    const speech: GreetingSpeech = {
      say: () => "Buenas",
      lexicon,
      clarity: () => 0,
      gesture: () => true,
    };
    const truth = known();
    const now = timeFor(speech);
    const out = run(truth, now, 1, speech);
    expect(out.events?.[0]?.data).toMatchObject({ understood: { [me]: true, [other]: true } });
    expect(run(known(), now, 1, speech)).toEqual(out);
    apply(truth, out);
    expect(truth.get(RELATIONS, other)?.toward[me]?.dims.familiarity).toBeGreaterThan(0);
  });

  it("con buena claridad se entiende y es determinista", () => {
    const speech: GreetingSpeech = { say: () => "Buenas", lexicon, clarity: () => 0.9 };
    const now = timeFor(speech);
    const x = run(known(), now, 1, speech);
    expect(x).toEqual(run(known(), now, 1, speech));
    expect(x.events?.[0]?.data).toMatchObject({ understood: { [me]: true, [other]: true } });
  });
});
