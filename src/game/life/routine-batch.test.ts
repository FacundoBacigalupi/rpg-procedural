import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EARTHLIKE_CLOCK as clock,
  EventLog,
  externalAccount,
  holderAccount,
  IdAllocator,
  Ledger,
  ledgerUnit,
  loadContent,
  makeId,
  Rng,
} from "../../core/index.ts";
import {
  ACTIONS,
  ActionCatalog,
  BODY_PLANS,
  BODY_STATE,
  COOKED,
  EATEN,
  ENTITY,
  type FoodDef,
  FRESH_CURSOR,
  GOODS,
  type GoodDef,
  INNATE,
  LOCATION,
  type LocalMap,
  newBody,
  PERSON,
  PLACE,
  RECIPES,
  Scheduler,
  SKILLS,
  SkillCatalog,
  TRAITS,
  type TradeRecipeDef,
  WORKSHOP,
  WORKSHOP_WASTE,
  WorldTruth,
} from "../../sim/index.ts";
import { actProcess, PLAN_STATE, planKey } from "./act.ts";
import { routineProcess } from "./routine.ts";
import { tradesProcess } from "./trades.ts";

const file = "content/body-plans/human.json";
const plans = loadContent(
  [BODY_PLANS],
  [{ kind: "body-plans", file, data: JSON.parse(readFileSync(file, "utf8")) }],
).all(BODY_PLANS);
const recipes = JSON.parse(readFileSync("content/trades/core.json", "utf8")) as TradeRecipeDef[];
const content = loadContent(
  [ACTIONS, SKILLS, TRAITS, RECIPES, GOODS],
  [
    "content/actions/core.json",
    "content/skills/core.json",
    "content/traits/human.json",
    "content/recipes/core.json",
    "content/goods/core.json",
  ].map((file) => ({
    kind: file.split("/")[1] as string,
    file,
    data: JSON.parse(readFileSync(file, "utf8")),
  })),
);
const actions = content
  .all(ACTIONS)
  .map((a) => (a.id === "eat" || a.id === "cook" ? { ...a, ease: 100 } : a));
const catalog = new ActionCatalog(actions);
const skills = new SkillCatalog(content.all(SKILLS), actions);
const home = makeId("household", 1);
const grain = ledgerUnit("good:grain");
const bread = ledgerUnit("good:flatbread");
const foods = [{ id: "grain", name: "grano", kcalPerGram: 3.6, waterPerGram: 0 }] as FoodDef[];
const goods = [
  { id: "grain", name: "grano", form: "good", priceCopperPerKg: 6 },
  { id: "flatbread", name: "pan", form: "good", priceCopperPerKg: 14 },
  { id: "copper", name: "cobre", form: "coin" },
] as GoodDef[];
const map: LocalMap = {
  cell: makeId("cell", 1),
  lonDeg: 180,
  neighbors: [[]],
  crossSeconds: [1],
  forest: [false],
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

function world(batch: boolean, verb?: "eat" | "cook", consumerBatch = true) {
  const truth = new WorldTruth(),
    log = new EventLog();
  const place = { kind: "cell", cell: map.cell } as const;
  log.append({
    id: makeId("event", 1),
    tick: 0,
    kind: "seed",
    actors: [],
    place,
    data: {},
    emissions: {},
    causes: [{ kind: "seed" }],
    resolution: "local",
  });
  const plan = plans[0];
  if (!plan) throw new Error("sin body plan");
  truth.setRaw(PLACE.name, makeId("place", 1), { name: "aldea", kind: "village", hexes: [0] });
  for (const n of [1, 2]) {
    const actor = makeId("agent", n);
    truth.set(ENTITY, actor, { id: actor, createdAt: 0, originEventId: makeId("event", 1) });
    truth.setRaw(PERSON.name, actor, { born: -30 * clock.year, sex: "male", household: home });
    truth.set(BODY_STATE, actor, newBody(plan, 55, 0));
    truth.set(LOCATION, actor, { hex: 0 });
    truth.set(INNATE, actor, Object.fromEntries(content.all(TRAITS).map((t) => [t.id, t.mean])));
  }
  const ledger = new Ledger({
    externals: {
      seed: [grain],
      [EATEN]: [grain],
      [COOKED]: [grain, bread],
      [WORKSHOP]: [bread],
      [WORKSHOP_WASTE]: [grain],
    },
  });
  ledger.post({
    tick: 0,
    eventId: makeId("event", 1),
    transfers: [
      {
        from: externalAccount("seed"),
        to: holderAccount(home),
        unit: grain,
        amount: verb ? 400 : 800,
      },
    ],
  });
  const scheduler = new Scheduler(
    {
      truth,
      log,
      ledger,
      clock,
      rng: Rng.root(7),
      ids: new IdAllocator({ event: 2, agent: 3 }),
      resolution: "local",
      scopes: (kind) => (kind === "agent" ? truth.ids(PERSON) : ["world"]),
      processes: [
        ...(verb
          ? [
              actProcess({
                economicBatch: true,
                serialEconomicVerbs: consumerBatch ? ["eat", "cook"] : ["trade", "give"],
                map,
                spaces: { spaces: [], edges: [] },
                catalog,
                skills,
                traits: content.all(TRAITS),
                bodyPlans: plans,
                goods,
                foods,
                recipes: content.all(RECIPES),
                statuses: [],
                clock,
                seed: 7,
                player: makeId("agent", 99),
              }),
            ]
          : []),
        routineProcess({
          economicBatch: batch,
          map,
          spaces: { spaces: [], edges: [] },
          bodyPlans: plans,
          foods,
          clock,
          seed: 7,
          placeOf: () => place,
        }),
        tradesProcess({
          economicBatch: true,
          clock,
          goods,
          recipes,
          assignments: [{ household: home, recipe: "bake-flatbread" }],
          placeOf: () => place,
        }),
      ],
    },
    { now: clock.day - 3600, seq: 0, queue: [] },
  );
  if (verb) {
    const actor = makeId("agent", 1);
    truth.set(PLAN_STATE, actor, {
      seq: 1,
      done: false,
      cursor: FRESH_CURSOR,
      lastBelieved: null,
      steps: [],
      plan: {
        actor,
        source: "utility",
        root: {
          kind: "do",
          verb,
          args: [{ role: "what", text: verb === "eat" ? "grano" : "pan plano" }],
          manner: [],
        },
        manner: [],
        causes: [],
      },
    });
    scheduler.schedule({
      at: clock.day,
      phase: "act",
      process: "life.act",
      scope: actor,
      reason: { kind: "state", entity: actor, key: planKey(1) },
    });
  }
  return { truth, log, ledger, scheduler };
}

describe("rutina y taller comparten despensa", () => {
  it("reproduce el doble débito sin incorporar la rutina al dominio", () => {
    const w = world(false);
    expect(() => w.scheduler.advanceTo(clock.day)).toThrow();
    expect(w.log.all().some((e) => e.kind === "routine.ate")).toBe(true);
    expect(w.log.all().some((e) => e.kind === "household.produced")).toBe(true);
  });
  it("el taller utiliza solamente el grano restante después de las comidas", () => {
    const w = world(true);
    expect(() => w.scheduler.advanceTo(clock.day)).not.toThrow();
    expect(w.log.all().filter((e) => e.kind === "routine.ate")).toHaveLength(2);
    expect(w.ledger.balance(holderAccount(home), grain)).toBeGreaterThanOrEqual(0);
    expect(w.ledger.balance(holderAccount(home), bread)).toBeLessThan(1040);
    expect(w.ledger.audit()).toEqual([]);
    expect(
      w.ledger.balance(holderAccount(home), grain) +
        w.ledger.balance(externalAccount(EATEN), grain) +
        w.ledger.balance(externalAccount(WORKSHOP_WASTE), grain),
    ).toBe(800);
  });
  it("el mismo seed conserva cuerpos, eventos y asientos", () => {
    const a = world(true),
      b = world(true);
    a.scheduler.advanceTo(clock.day);
    b.scheduler.advanceTo(clock.day);
    expect(a.truth.rows()).toEqual(b.truth.rows());
    expect(a.log.all()).toEqual(b.log.all());
    expect(a.ledger.journal()).toEqual(b.ledger.journal());
  });
  it("un plan pendiente saltea solo la rutina de su actor, no la comida de su familiar", () => {
    const w = world(true);
    const actor = makeId("agent", 1);
    w.truth.setRaw(PLAN_STATE.name, actor, { done: false });
    w.scheduler.advanceTo(clock.day);
    const meals = w.log.all().filter((e) => e.kind === "routine.ate");
    expect(meals).toHaveLength(1);
    expect(meals[0]?.actors).toEqual([makeId("agent", 2)]);
    expect(w.ledger.audit()).toEqual([]);
  });
  it("sin opt-in conserva el descriptor anterior", () => {
    const p = routineProcess({
      map,
      spaces: { spaces: [], edges: [] },
      bodyPlans: plans,
      foods,
      clock,
      seed: 7,
      placeOf: () => ({ kind: "cell", cell: map.cell }),
    });
    expect(p.serialDomain).toBeUndefined();
    expect(p.serialGroup).toBeUndefined();
  });
});

describe("planes consumidores y comida de familiares", () => {
  it.each(["eat", "cook"] as const)("reproduce %s fuera del dominio", (verb) => {
    const w = world(true, verb, false);
    expect(() => w.scheduler.advanceTo(clock.day)).toThrow();
    expect(w.log.all().some((e) => e.kind === `action.${verb}`)).toBe(true);
  });
  it.each(["eat", "cook"] as const)("%s lee la despensa común y conserva agenda", (verb) => {
    const w = world(true, verb);
    expect(() => w.scheduler.advanceTo(clock.day)).not.toThrow();
    expect(w.log.all().filter((e) => e.kind === `action.${verb}`)).toHaveLength(1);
    expect(w.ledger.audit()).toEqual([]);
    expect(w.ledger.balance(holderAccount(home), grain)).toBeGreaterThanOrEqual(0);
    expect(w.scheduler.state().queue.some((q) => q.process === "life.act")).toBe(true);
    expect(
      w.ledger.balance(externalAccount(verb === "eat" ? EATEN : COOKED), grain),
    ).toBeGreaterThan(0);
    expect(
      w.ledger.balance(holderAccount(home), grain) +
        w.ledger.balance(externalAccount(EATEN), grain) +
        w.ledger.balance(externalAccount(COOKED), grain) +
        w.ledger.balance(externalAccount(WORKSHOP_WASTE), grain),
    ).toBe(400);
    const repeated = world(true, verb);
    repeated.scheduler.advanceTo(clock.day);
    expect(w.truth.rows()).toEqual(repeated.truth.rows());
    expect(w.log.all()).toEqual(repeated.log.all());
    expect(w.ledger.journal()).toEqual(repeated.ledger.journal());
  });
});
