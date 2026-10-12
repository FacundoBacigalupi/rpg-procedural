import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EARTHLIKE_CLOCK,
  EventLog,
  externalAccount,
  holderAccount,
  IdAllocator,
  Ledger,
  ledgerUnit,
  loadContent,
  makeId,
  Rng,
  type Tick,
} from "../../core/index.ts";
import {
  assignPendingFact,
  BODY_PLANS,
  BODY_STATE,
  checkInvariants,
  draftEvent,
  ENTITY,
  FOODS,
  HOUSEHOLD,
  LOCATION,
  type LocalMap,
  newBody,
  PENDING_FACTS,
  PERSON,
  type ProcessDef,
  Scheduler,
  setComponent,
  WorldTruth,
} from "../../sim/index.ts";
import { FULL_PROFILE } from "./profile.ts";
import {
  ASLEEP,
  CATCH_UP_DAILY_PROCESS,
  CATCH_UP_WAKE_PROCESS,
  CAUGHT_UP_EVENT,
  catchUpDue,
  catchUpProcess,
  PENDING_APPLIED_EVENT,
  sleepPolicyProcess,
  sleepWorkPending,
} from "./sleepers.ts";

const clock = EARTHLIKE_CLOCK;
const actor = makeId("agent", 1);
const player = makeId("agent", 2);
const home = makeId("household", 1);
const playerHome = makeId("household", 2);
const cell = makeId("cell", 1);
const grain = ledgerUnit("good:grain");
const content = loadContent(
  [BODY_PLANS, FOODS],
  [
    ["body-plans", "human"],
    ["foods", "stores"],
  ].map(([kind, file]) => ({
    kind: kind as string,
    file: `${kind}/${file}`,
    data: JSON.parse(readFileSync(`content/${kind}/${file}.json`, "utf8")),
  })),
);
const map: LocalMap = {
  cell,
  lonDeg: 0,
  neighbors: [[1], [0, 2], [1, 3], [2, 4], [3, 5], [4, 6], [5]],
  crossSeconds: Array(7).fill(3600),
  forest: Array(7).fill(false),
  climate: {
    cell: "cell:1",
    latDeg: 0,
    axialTiltDeg: 23,
    annualMeanC: 20,
    seasonalRangeC: 5,
    annualPrecipMm: 800,
    windEast: 1,
    windNorth: 0,
  },
};

function distantSleeper() {
  const truth = new WorldTruth();
  const log = new EventLog();
  const place = { kind: "cell", cell } as const;
  log.append({
    id: makeId("event", 1),
    tick: 0,
    kind: "test.sleep_setup",
    actors: [],
    place,
    causes: [{ kind: "seed" }],
    data: {},
    emissions: {},
    resolution: "local",
  });
  for (const id of [actor, player, home, playerHome, cell])
    truth.set(ENTITY, id, { id, createdAt: 0, originEventId: makeId("event", 1) });
  for (const [id, household, hex] of [
    [actor, home, 6],
    [player, playerHome, 0],
  ] as const) {
    truth.set(PERSON, id, {
      sex: "male",
      born: (-25 * clock.year) as Tick,
      mother: null,
      father: null,
      spouse: null,
      household,
    });
    truth.set(HOUSEHOLD, household, { settlement: makeId("settlement", 1), members: [id] });
    truth.set(LOCATION, id, { hex });
  }
  const plan = content.all(BODY_PLANS)[0];
  const food = content.all(FOODS).find((entry) => entry.id === FULL_PROFILE.sleepers.food);
  if (!plan || !food) throw new Error("sin cuerpo o ración del perfil");
  truth.set(BODY_STATE, actor, newBody(plan, 55, 0));
  const ledger = new Ledger({ externals: { seed: [grain], eaten: [grain] } });
  ledger.post({
    tick: 0,
    eventId: makeId("event", 1),
    transfers: [
      { unit: grain, from: externalAccount("seed"), to: holderAccount(home), amount: 10_000 },
    ],
  });
  const factProcess: ProcessDef = {
    id: "test.sleep_fact",
    system: "test",
    scope: "world",
    cadence: {},
    representation: "individual",
    phase: "settle",
    reads: [ASLEEP.name, PENDING_FACTS.name],
    writes: [PENDING_FACTS.name],
    run(ctx) {
      const change = assignPendingFact(ctx.truth, actor, {
        kind: "blow",
        at: ctx.now,
        cause: draftEvent(0),
        blow: { kind: "blunt", force: 0.1 },
      });
      if (!change) throw new Error("el agregado solo asigna a quien ya duerme");
      return {
        changes: [change],
        events: [
          {
            kind: "test.aggregate_blow",
            actors: [actor],
            place,
            causes: [{ kind: "seed" }],
            data: {},
            emissions: {},
          },
        ],
      };
    },
  };
  const approach: ProcessDef = {
    id: "test.sleep_approach",
    system: "test",
    scope: "world",
    cadence: {},
    representation: "individual",
    phase: "settle",
    reads: [],
    writes: [LOCATION.name],
    run() {
      return { changes: [setComponent(LOCATION, player, { hex: 5 })] };
    },
  };
  const scheduler = new Scheduler({
    rng: Rng.root(7),
    clock,
    truth,
    log,
    ledger,
    ids: new IdAllocator({ event: 2 }),
    resolution: "local",
    processes: [
      sleepPolicyProcess({
        player,
        map,
        near: FULL_PROFILE.sleepers.near,
        bonded: (t, who) => t.get(PERSON, who)?.household === t.get(PERSON, player)?.household,
        important: () => false,
        pending: sleepWorkPending,
      }),
      ...(["wake", "daily"] as const).map((mode) =>
        catchUpProcess({
          mode,
          plans: [plan],
          clock,
          lonDeg: 0,
          player,
          placeOf: () => place,
          ration: { unit: grain, kcalPerGram: food.kcalPerGram, waterPerGram: food.waterPerGram },
        }),
      ),
      factProcess,
      approach,
    ],
    scopes: (kind, t, def) => {
      if (kind !== "agent") return ["world"];
      const sleep = t.get(ASLEEP, actor);
      return sleep &&
        (def.id === CATCH_UP_WAKE_PROCESS || def.id === CATCH_UP_DAILY_PROCESS) &&
        catchUpDue(def.id === CATCH_UP_WAKE_PROCESS ? "wake" : "daily", sleep)
        ? [actor]
        : [];
    },
  });
  scheduler.schedule({
    at: 6 * 3600,
    phase: "settle",
    process: factProcess.id,
    scope: "world",
    reason: { kind: "seed" },
  });
  scheduler.schedule({
    at: 2 * clock.day + 3600,
    phase: "settle",
    process: approach.id,
    scope: "world",
    reason: { kind: "seed" },
  });
  return { truth, log, ledger, scheduler };
}

describe("cobertura dirigida de dormidos con scheduler real", () => {
  it("registra, aplica hecho y comida por día, y despierta al acercarse sin duplicar", () => {
    const w = distantSleeper();
    w.scheduler.advanceTo(3600);
    expect(w.truth.get(ASLEEP, actor)).toEqual({ since: 3600, lastAdvanced: 0 });
    w.scheduler.advanceTo(clock.day);
    expect(w.truth.get(BODY_STATE, actor)?.updatedAt).toBe(clock.day);
    expect(w.truth.get(PENDING_FACTS, actor)).toBeUndefined();
    const applied = w.log.all().filter((event) => event.kind === PENDING_APPLIED_EVENT);
    expect(applied).toHaveLength(1);
    expect(applied[0]?.data).toMatchObject({ fact: "blow", at: 6 * 3600 });
    expect(applied[0]?.causes).toEqual([
      {
        kind: "event",
        event: w.log.all().find((event) => event.kind === "test.aggregate_blow")?.id,
      },
    ]);
    expect(w.ledger.balance(externalAccount("eaten"), grain)).toBeGreaterThan(0);
    w.scheduler.advanceTo(2 * clock.day + 2 * 3600);
    expect(w.truth.get(ASLEEP, actor)).toBeUndefined();
    expect(w.truth.get(BODY_STATE, actor)?.updatedAt).toBe(2 * clock.day + 2 * 3600);
    const catchUps = w.log.all().filter((event) => event.kind === CAUGHT_UP_EVENT);
    expect(catchUps.map((event) => event.data)).toMatchObject([
      { from: 0, to: clock.day },
      { from: clock.day, to: 2 * clock.day },
      { from: 2 * clock.day, to: 2 * clock.day + 2 * 3600 },
    ]);
    const eaten = w.ledger.balance(externalAccount("eaten"), grain);
    w.scheduler.advanceTo(2 * clock.day + 5 * 3600);
    expect(w.ledger.balance(externalAccount("eaten"), grain)).toBe(eaten);
    expect(w.log.all().filter((event) => event.kind === CAUGHT_UP_EVENT)).toHaveLength(3);
    expect(w.log.all().filter((event) => event.kind === PENDING_APPLIED_EVENT)).toHaveLength(1);
    expect(w.ledger.balance(holderAccount(home), grain) + eaten).toBe(10_000);
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  });

  it("seed y hechos iguales repiten cuerpo, eventos y asientos", () => {
    const a = distantSleeper();
    const b = distantSleeper();
    for (const w of [a, b]) w.scheduler.advanceTo(2 * clock.day + 5 * 3600);
    expect(a.truth.rows()).toEqual(b.truth.rows());
    expect(a.log.all()).toEqual(b.log.all());
    expect(a.ledger.journal()).toEqual(b.ledger.journal());
  });
});
