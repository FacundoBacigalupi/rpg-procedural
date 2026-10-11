import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  type EntityBase,
  type Event,
  loadContent,
  makeId,
  type PlaceId,
  type PlaceRef,
  Rng,
} from "../../core/index.ts";
import {
  ActionCatalog,
  BODY_PLANS,
  BODY_STATE,
  type BodyPlanDef,
  checkInvariants,
  ENTITY,
  FRESH_CURSOR,
  LOCATION,
  type LocalMap,
  newBody,
  PERSON,
  PLACE,
  type ProcessContext,
  type ProcessResult,
  WorldTruth,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { PLAN_STATE, type PlanState } from "./act.ts";
import { NPC_DECISION } from "./decide.ts";
import { Life } from "./life.ts";
import {
  INTERRUPTED_EVENT,
  NPC_ALARMS,
  NPC_REACT,
  npcInterruptProcess,
  npcReactProcess,
} from "./npc-interrupt.ts";
import { NPC_JOURNEY, NPC_PAUSED, npcVerbsProcess } from "./npc-verbs.ts";
import { TRANSIT } from "./transit.ts";
import { living } from "./world.ts";

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}

const content = loadContent(
  [BODY_PLANS],
  [
    {
      kind: "body-plans",
      file: "b.json",
      data: JSON.parse(readFileSync("content/body-plans/human.json", "utf8")),
    },
  ],
);
const plan = content.all(BODY_PLANS)[0] as BodyPlanDef;
const me = makeId("agent", 1);
const player = makeId("agent", 99);
const site = { kind: "place", place: "place:1" as PlaceId } satisfies PlaceRef;

function world(fatigue: number, going: boolean) {
  const truth = new WorldTruth();
  truth.set(ENTITY, me, {
    id: me,
    originEventId: makeId("event", 1),
    createdAt: 0,
  } satisfies EntityBase);
  truth.set(BODY_STATE, me, { ...newBody(plan, 60, 0), fatigue });
  if (going) {
    const state: PlanState = {
      seq: 3,
      plan: {
        actor: me,
        source: "utility",
        goal: "fieldwork",
        root: {
          kind: "seq",
          steps: [
            { kind: "do", verb: "move", args: [], manner: [] },
            { kind: "do", verb: "work", args: [], manner: [] },
            { kind: "do", verb: "move", args: [], manner: [] },
          ],
        },
        manner: [],
        causes: [],
      },
      cursor: { ...FRESH_CURSOR, path: [1] },
      lastBelieved: null,
      steps: [{ verb: "move", at: 10, self: {} as never }],
      done: false,
    };
    truth.set(PLAN_STATE, me, state);
    truth.set(NPC_JOURNEY, me, { place: "place:7", since: 0, decision: "move:place:7" });
  }
  return truth;
}

function run(truth: WorldTruth, who: AgentId = me, map?: LocalMap): ProcessResult {
  const p = npcInterruptProcess({
    player,
    plans: [plan],
    placeOf: () => site,
    ...(map ? { map } : {}),
  });
  const ctx = {
    now: 3600,
    window: 3600,
    windowIndex: 1,
    scope: who,
    resolution: "local",
    phase: "perceive",
    truth,
    ledger: undefined,
    rng: Rng.root(1),
    item: undefined,
    recent: [],
    newId() {
      throw new Error("no crea entidades");
    },
  } as unknown as ProcessContext;
  return p.run(ctx);
}

function apply(truth: WorldTruth, out: ProcessResult) {
  for (const c of out.changes ?? []) {
    if (c.op === "delete") truth.deleteRaw(c.table, c.id);
    else if (c.op === "set") truth.setRaw(c.table, c.id, c.value);
  }
}

describe("life.npc_interrupt", () => {
  it("un signo grave nuevo corta el plan en curso y deja el resultado parcial", () => {
    const truth = world(0.95, true);
    const out = run(truth);
    const ev = out.events?.[0];
    expect(ev?.kind).toBe(INTERRUPTED_EVENT);
    expect(ev?.data).toMatchObject({
      why: "body_alarm",
      signs: ["exhausted"],
      plan: "fieldwork",
      done: ["move"],
      cut: "work",
      journey: "place:7",
    });
    expect(ev?.causes).toEqual([{ kind: "state", entity: me, key: "body" }]);
    apply(truth, out);
    expect(truth.get(PLAN_STATE, me)?.done).toBe(true);
    expect(truth.get(NPC_JOURNEY, me)).toBeUndefined();
    expect(truth.get(NPC_ALARMS, me)?.signs).toEqual(["exhausted"]);
  });

  it("lo que ya sentía no vuelve a cortar; sin plan o el personaje, nada", () => {
    const truth = world(0.95, true);
    apply(truth, run(truth));
    // Un plan nuevo con el mismo signo ya conocido no se corta otra vez.
    truth.set(PLAN_STATE, me, { ...(truth.get(PLAN_STATE, me) as PlanState), done: false });
    expect(run(truth).events ?? []).toEqual([]);
    // Sin plan en curso solo anota el signo.
    const idle = world(0.95, false);
    const out = run(idle);
    expect(out.events ?? []).toEqual([]);
    expect(out.changes?.[0]).toMatchObject({ table: NPC_ALARMS.name });
    // El personaje decide él, y descansado no hay alarma.
    expect(run(world(0.95, true), player)).toEqual({});
    expect(run(world(0.1, true))).toEqual({});
  });

  it("al pasar el signo se olvida y puede volver a cortar", () => {
    const truth = world(0.95, true);
    apply(truth, run(truth));
    truth.set(BODY_STATE, me, { ...newBody(plan, 60, 0), fatigue: 0.1 });
    apply(truth, run(truth));
    expect(truth.get(NPC_ALARMS, me)).toBeUndefined();
    truth.set(BODY_STATE, me, { ...newBody(plan, 60, 0), fatigue: 0.95 });
    truth.set(PLAN_STATE, me, { ...(truth.get(PLAN_STATE, me) as PlanState), done: false });
    expect(run(truth).events?.[0]?.kind).toBe(INTERRUPTED_EVENT);
  });
});

describe("lo que otro le hace o le dice", () => {
  const other = makeId("agent", 2);
  const event = (id: number, kind: string, actors: string[], tick = 3000): Event =>
    ({
      id: makeId("event", id),
      tick,
      kind,
      actors,
      place: site,
      data: {},
      emissions: {},
      causes: [],
      resolution: "local",
    }) as unknown as Event;

  function react(truth: WorldTruth, recent: Event[]): ProcessResult {
    const p = npcReactProcess({ player });
    return p.run({
      now: 3600,
      window: 0,
      windowIndex: undefined,
      scope: "world",
      resolution: "local",
      phase: "perceive",
      truth,
      ledger: undefined,
      rng: Rng.root(1),
      item: undefined,
      recent,
      newId() {
        throw new Error("no crea entidades");
      },
    } as unknown as ProcessContext);
  }

  it("anota el golpe o la frase de otro donde el NPC es parte; el golpe vale más", () => {
    const truth = world(0.1, true);
    const out = react(truth, [
      event(5, "action.strike", [other, me]),
      event(6, "action.speak", [other, me]),
      event(7, "action.strike", [me, other]),
      event(8, "action.strike", [other, player]),
      event(9, "body.died", [other, me]),
    ]);
    apply(truth, out);
    expect(truth.get(NPC_REACT, me)).toMatchObject({
      kind: "attacked",
      event: makeId("event", 5),
      who: other,
    });
    expect(truth.get(NPC_REACT, player)).toBeUndefined();
    expect(react(truth, [event(10, "action.move", [other, me])])).toEqual({});
  });

  it("un golpe corta el plan, cita el evento y no corta dos veces por el mismo", () => {
    const truth = world(0.1, true);
    truth.set(NPC_REACT, me, { kind: "attacked", event: makeId("event", 5), who: other, at: 3000 });
    const out = run(truth);
    const ev = out.events?.[0];
    expect(ev?.data).toMatchObject({ why: "attacked", plan: "fieldwork", cut: "work" });
    expect(ev?.actors).toEqual([me, other]);
    expect(ev?.causes).toEqual([{ kind: "event", event: makeId("event", 5) }]);
    apply(truth, out);
    expect(truth.get(PLAN_STATE, me)?.done).toBe(true);
    expect(truth.get(NPC_ALARMS, me)?.seen).toBe(makeId("event", 5));
    truth.set(PLAN_STATE, me, { ...(truth.get(PLAN_STATE, me) as PlanState), done: false });
    expect(run(truth).events ?? []).toEqual([]);
  });

  it("una frase también corta; una reacción vieja no corta un plan nuevo", () => {
    const talk = world(0.1, true);
    talk.set(NPC_REACT, me, { kind: "spoken_to", event: makeId("event", 6), who: other, at: 3000 });
    expect(run(talk).events?.[0]?.data).toMatchObject({ why: "spoken_to" });
    const old = world(0.1, true);
    old.set(NPC_REACT, me, { kind: "attacked", event: makeId("event", 5), who: other, at: -4000 });
    expect(run(old).events ?? []).toEqual([]);
  });
});

describe("retomar lo cortado y la posición a medio camino", () => {
  // Una línea de seis hexes de 1000 s cada uno: 0-1-2-3-4-5.
  const line = {
    neighbors: [[1], [0, 2], [1, 3], [2, 4], [3, 5], [4]],
    crossSeconds: [1000, 1000, 1000, 1000, 1000, 1000],
  } as unknown as LocalMap;

  it("al cortar queda lo que hace falta para retomar: plan, cursor, pasos y viaje", () => {
    const truth = world(0.95, true);
    apply(truth, run(truth));
    const paused = truth.get(NPC_PAUSED, me);
    expect(paused).toMatchObject({
      why: "body_alarm",
      at: 3600,
      cursor: { path: [1] },
      journey: { place: "place:7" },
    });
    expect(paused?.plan.goal).toBe("fieldwork");
    expect(paused?.steps.map((s) => s.verb)).toEqual(["move"]);
  });

  it("el viaje cortado deja el cuerpo en el hex que le tocaba, no en el destino ya fijado", () => {
    const truth = world(0.95, true);
    truth.set(NPC_JOURNEY, me, { place: "place:7", since: 0, decision: "d", from: 0 });
    // `life.act` ya lo dejó en el fin del tramo (hex 5); pasaron 3600 s: lleva tres hexes.
    truth.set(LOCATION, me, { hex: 5 });
    const out = run(truth, me, line);
    apply(truth, out);
    expect(truth.get(LOCATION, me)?.hex).toBe(3);
    expect(truth.get(TRANSIT, me)).toEqual({ seen: 3, at: 3600 });
    expect(truth.get(NPC_JOURNEY, me)).toBeUndefined();
  });

  const resumeOpts = {
    catalog: new ActionCatalog([], []),
    verbs: ["move"],
    day: 86_400,
    player,
    placeOf: () => site,
    resume: { plans: [plan], after: 3600, within: 86_400 },
  };
  function resume(truth: WorldTruth, now: number): ProcessResult {
    return npcVerbsProcess(resumeOpts).run({
      now,
      window: 3600,
      windowIndex: 1,
      scope: me,
      resolution: "local",
      phase: "decide",
      truth,
      ledger: undefined,
      rng: Rng.root(1),
      item: undefined,
      recent: [],
      newId() {
        throw new Error("no crea entidades");
      },
    } as unknown as ProcessContext);
  }
  function cutWorld() {
    const truth = world(0.95, true);
    apply(truth, run(truth));
    // Se repone: ya no hay signos graves.
    truth.set(BODY_STATE, me, { ...newBody(plan, 60, 0), fatigue: 0.1 });
    return truth;
  }

  it("repuesto, retoma el plan desde donde quedó, reabre el viaje y lo dice", () => {
    const truth = cutWorld();
    const out = resume(truth, 3600 + 2 * 3600);
    apply(truth, out);
    const state = truth.get(PLAN_STATE, me);
    expect(state).toMatchObject({ seq: 4, done: false, cursor: { path: [1] } });
    expect(state?.plan.goal).toBe("fieldwork");
    expect(state?.steps.map((s) => s.verb)).toEqual(["move"]);
    expect(truth.get(NPC_JOURNEY, me)).toMatchObject({ place: "place:7" });
    expect(truth.get(NPC_PAUSED, me)).toBeUndefined();
    expect(out.events?.[0]).toMatchObject({
      kind: "npc.resumed",
      data: { plan: "fieldwork", from: "work", journey: "place:7", why: "body_alarm" },
    });
    expect(out.schedule?.[0]).toMatchObject({ phase: "act", scope: me });
  });

  it("no retoma antes de tiempo, si sigue mal, ni cuando ya pasó mucho; lo viejo se olvida", () => {
    const early = cutWorld();
    expect(resume(early, 3600 + 600)).toEqual({});
    const unwell = world(0.95, true);
    apply(unwell, run(unwell));
    expect(resume(unwell, 3600 + 2 * 3600)).toEqual({});
    const old = cutWorld();
    const out = resume(old, 3600 + 2 * 86_400);
    expect(out.events ?? []).toEqual([]);
    apply(old, out);
    expect(old.get(NPC_PAUSED, me)).toBeUndefined();
    expect(old.get(PLAN_STATE, me)?.done).toBe(true);
  });
});

describe("en una vida con el proceso encendido", () => {
  it("el NPC agotado en pleno viaje se interrumpe y el mundo sigue coherente", () => {
    const all = loadContent(GAME_CONTENT_KINDS, sources("content"));
    const life = Life.create(7, all, {
      npcVerbs: ["move"],
      npcJourneyDays: 6,
      npcInterrupt: true,
      npcTransit: true,
    });
    const w = life.world;
    const npc = living(w.truth).find(
      (x) =>
        x !== life.player && (w.truth.get(PERSON, x)?.born ?? 0) < life.now - 20 * 365 * 86_400,
    ) as AgentId;
    const place = w.truth.ids(PLACE)[0] as string;
    const body = w.truth.get(BODY_STATE, npc);
    if (!body) throw new Error("sin cuerpo");
    w.truth.set(NPC_DECISION, npc, {
      at: life.now,
      id: `move:${place}+toward:agent:99`,
      verb: "move",
      target: place,
      utility: 1,
      options: 2,
    } as never);
    life.advanceTo(life.now + 2 * 3600);
    // Ya en camino, el cuerpo se le agota: la siguiente hora lo corta.
    w.truth.set(BODY_STATE, npc, { ...(w.truth.get(BODY_STATE, npc) ?? body), fatigue: 0.95 });
    life.advanceTo(life.now + 3 * 3600);
    const cut = w.log.all().find((e) => e.kind === INTERRUPTED_EVENT && e.actors[0] === npc);
    expect(cut).toBeDefined();
    expect(w.truth.get(NPC_JOURNEY, npc)).toBeUndefined();
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  }, 240_000);
});
