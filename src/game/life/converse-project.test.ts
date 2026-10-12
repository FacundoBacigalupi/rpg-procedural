import { describe, expect, it } from "vitest";
import { EARTHLIKE_CLOCK, EventLog, IdAllocator, makeId, Rng } from "../../core/index.ts";
import { GAME_CONTENT_KINDS } from "../../game/index.ts";
import { loadContentDir } from "../../persistence/index.ts";
import {
  ACTIONS,
  ActionCatalog,
  BODY_PLANS,
  BODY_STATE,
  ENTITY,
  FACE,
  GOODS,
  HEARD,
  INNATE,
  LOCATION,
  newBody,
  PERSON,
  PERSON_NAME,
  PLANS,
  RELATION_BONDS,
  RELATION_DIMS,
  RELATIONS,
  Scheduler,
  SECRETS,
  SPEECH_LINES,
  type SpaceGraph,
  STATUSES,
  strangerDims,
  TRAITS,
  WorldTruth,
} from "../../sim/index.ts";
import { converseProcess, listenTo, PENDING } from "./converse.ts";
import {
  type ConverseProjectionEffect,
  converseProjectionProcess,
  foldConversationEffects,
} from "./converse-project.ts";

const content = loadContentDir("content", GAME_CONTENT_KINDS);
const catalog = new ActionCatalog(content.all(ACTIONS), content.all(PLANS));
const a = makeId("agent", 1);
const b = makeId("agent", 2);
const c = makeId("agent", 3);
const deadOne = makeId("agent", 4);
const deadTwo = makeId("agent", 5);
const spaces: SpaceGraph = {
  spaces: [
    {
      key: "near",
      kind: "square",
      hex: 0,
      area: 4,
      indoor: false,
      daylight: 1,
      lamp: 0,
      noise: 0,
      clearSight: 1,
    },
  ],
  edges: [],
};
const place = { kind: "cell", cell: makeId("cell", 1) } as const;
const baseOptions = {
  spaces,
  catalog,
  goods: content.all(GOODS),
  statuses: content.all(STATUSES),
  dims: content.all(RELATION_DIMS),
  bonds: content.all(RELATION_BONDS),
  lines: content.all(SPEECH_LINES),
  traits: content.all(TRAITS),
  day: EARTHLIKE_CLOCK.day,
  year: EARTHLIKE_CLOCK.year,
  placeOf: () => place,
};

function fixture(project = true, seed = 7) {
  const truth = new WorldTruth();
  const bodyPlan = content.all(BODY_PLANS)[0];
  if (!bodyPlan) throw new Error("plan corporal ausente");
  for (const [id, name] of [
    [a, "Ana"],
    [b, "Bruno"],
    [c, "Caro"],
    [deadOne, "Mateo"],
    [deadTwo, "Lina"],
  ] as const) {
    truth.set(ENTITY, id, {
      id,
      originEventId: "event:1",
      createdAt: 0,
      ...(id === deadOne || id === deadTwo ? { endedAt: 1, endEventId: "event:1" } : {}),
    } as never);
    truth.set(PERSON, id, {
      sex: "male",
      born: -25 * EARTHLIKE_CLOCK.year,
      mother: null,
      father: null,
      spouse: null,
      household: "household:1",
    } as never);
    truth.set(PERSON_NAME, id, {
      language: "test",
      parts: [
        {
          kind: "given",
          form: name,
          lexemes: [],
          meaning: [],
          givenBy: null,
          event: "event:1",
          usedBy: "all",
        },
      ],
    } as never);
    truth.set(LOCATION, id, { hex: 0, space: "near" });
    truth.set(INNATE, id, {});
    truth.set(BODY_STATE, id, newBody(bodyPlan, 55, 0));
    truth.set(FACE, id, { value: 0.5, updated: 0 });
  }
  const log = EventLog.from([
    {
      id: makeId("event", 1),
      tick: 0,
      kind: "initial",
      actors: [],
      place,
      data: {},
      emissions: {},
      causes: [{ kind: "seed" }],
      resolution: "local",
    },
  ]);
  const scheduler = new Scheduler({
    rng: Rng.root(seed),
    clock: EARTHLIKE_CLOCK,
    truth,
    log,
    ids: new IdAllocator({ event: 2 }),
    resolution: "local",
    processes: [
      converseProcess({ ...baseOptions, projectSharedEffects: project }),
      ...(project ? [converseProjectionProcess()] : []),
    ],
  });
  const say = (from: typeof a, to: typeof b, text: string) => {
    const input = listenTo(from, to, text, 1, 0, 10);
    for (const change of input.changes) {
      if (change.op !== "set") throw new Error("escucha debe crear pending");
      truth.setRaw(change.table, change.id, change.value);
    }
    for (const item of input.schedule) scheduler.schedule(item);
  };
  return { truth, log, scheduler, say };
}

describe("conversaciones simultáneas con proyección causal única", () => {
  it("dos respuestas al mismo hablante conservan ambas noticias y sus causas", () => {
    const run = (seed: number, project = true) => {
      const world = fixture(project, seed);
      for (const [listener, about] of [
        [b, deadOne],
        [c, deadTwo],
      ] as const) {
        world.truth.set(SECRETS, listener, { items: [{ about, attr: "alive", stakes: 0 }] });
        world.truth.set(RELATIONS, listener, {
          originEventId: "event:1",
          toward: {
            [a]: {
              dims: { ...strangerDims(baseOptions.dims), trust: 1, affection: 1, familiarity: 1 },
              bonds: [],
              updated: 0,
              history: [],
            },
          },
        } as never);
        world.truth.set(INNATE, listener, { control: -5, reactivity: 5 });
      }
      world.say(a, b, "¿Sabés dónde está Mateo?");
      world.say(a, c, "¿Sabés dónde está Lina?");
      world.scheduler.advanceTo(10);
      const replies = world.log.all().filter((e) => e.kind === "action.speak");
      expect(replies).toHaveLength(2);
      expect(world.truth.ids(PENDING)).toEqual([]);
      for (const reply of replies) {
        expect(reply.causes).toEqual([
          expect.objectContaining({ kind: "state", entity: reply.actors[0] }),
        ]);
        expect(reply.data).toBeDefined();
      }
      return { claims: world.truth.get(HEARD, a), events: world.log.all() };
    };
    let coveredSeed = -1;
    for (let seed = 0; seed < 64; seed++) {
      if (run(seed).claims?.claims.length === 2) {
        coveredSeed = seed;
        break;
      }
    }
    expect(coveredSeed).toBeGreaterThanOrEqual(0);
    expect(() => run(coveredSeed, false)).toThrow(
      /conflicto de escritura fuera de act.*dialogue.heard/,
    );
    const result = run(coveredSeed);
    expect(result.claims?.claims.map((claim) => claim.about).sort()).toEqual([deadOne, deadTwo]);
    expect(run(coveredSeed)).toEqual(result);
  });

  it("un actor que recibe un insulto y obtiene obediencia conserva ambas variaciones de cara", () => {
    const world = fixture();
    world.truth.set(INNATE, c, { boldness: -5, willpower: -5, constitution: -5, reactivity: -5 });
    world.truth.set(RELATIONS, c, {
      originEventId: "event:1",
      toward: {
        [b]: {
          dims: { ...strangerDims(baseOptions.dims), fear: 1, respect: 1, familiarity: 1 },
          bonds: [],
          updated: 0,
          history: [],
        },
      },
    } as never);
    world.say(a, b, "Sos un inútil");
    world.say(b, c, "Te voy a matar");
    world.scheduler.advanceTo(10);
    const effects = world.log
      .all()
      .filter((e) => e.kind === "action.speak")
      .flatMap(
        (e) =>
          (e.data as { conversationEffects?: ConverseProjectionEffect[] }).conversationEffects ??
          [],
      );
    const mine = effects.filter((effect) => effect.kind === "face" && effect.actor === b);
    expect(mine).toHaveLength(2);
    const before = new WorldTruth();
    before.set(FACE, b, { value: 0.5, updated: 0 });
    const folded = foldConversationEffects(before, mine).find(
      (change) => change.table === FACE.name,
    );
    expect(folded?.op).toBe("set");
    if (folded?.op !== "set") throw new Error("proyección de cara ausente");
    expect(world.truth.get(FACE, b)).toEqual(folded.value);
  });

  it("una conversación aislada conserva el resultado directo y el default no lleva payload nuevo", () => {
    const direct = fixture(false);
    const projected = fixture();
    for (const world of [direct, projected]) {
      world.say(a, b, "Sos un inútil");
      world.scheduler.advanceTo(10);
    }
    expect(projected.truth.get(FACE, b)).toEqual(direct.truth.get(FACE, b));
    expect(direct.log.all().find((e) => e.kind === "action.speak")?.data).not.toHaveProperty(
      "conversationEffects",
    );
  });

  it("acota la cara tras cada efecto confirmado y conserva la última noticia sobre alguien", () => {
    const truth = new WorldTruth();
    truth.set(FACE, a, { value: 0.5, updated: 0 });
    const changes = foldConversationEffects(truth, [
      { kind: "face", actor: a, delta: 0.8, at: 10 },
      { kind: "face", actor: a, delta: -0.8, at: 10 },
      { kind: "heard", actor: a, claim: { about: b, claim: "dead", from: c, at: 10 } },
      { kind: "heard", actor: a, claim: { about: b, claim: "alive", from: b, at: 10 } },
    ]);
    expect(changes).toHaveLength(2);
    for (const change of changes) {
      if (change.op !== "set") throw new Error("proyección inesperada");
      truth.setRaw(change.table, change.id, change.value);
    }
    expect(truth.get(FACE, a)?.value).toBeCloseTo(0.2, 12);
    expect(truth.get(HEARD, a)?.claims).toEqual([{ about: b, claim: "alive", from: b, at: 10 }]);
  });
});
