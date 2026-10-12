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
} from "../../core/index.ts";
import {
  ACTIONS,
  ActionCatalog,
  BODY_PLANS,
  BODY_STATE,
  ENTITY,
  FRESH_CURSOR,
  type GoodDef,
  INNATE,
  LOCATION,
  type LocalMap,
  newBody,
  PERSON,
  PLACE,
  type ProcessContext,
  Scheduler,
  SKILLS,
  SkillCatalog,
  TRAITS,
  WORKSHOP,
  WORKSHOP_WASTE,
  WorldTruth,
} from "../../sim/index.ts";
import { type ActOptions, actProcess, PLAN_STATE, planKey } from "./act.ts";
import { tradeProjectionProcess } from "./trade-projection.ts";
import { tradesProcess } from "./trades.ts";
import { watchingProjectionProcess } from "./watching-project.ts";

const kinds = [ACTIONS, SKILLS, TRAITS, BODY_PLANS] as const;
const files = [
  "content/actions/core.json",
  "content/skills/core.json",
  "content/traits/human.json",
  "content/body-plans/human.json",
];
const content = loadContent(
  kinds,
  files.map((file) => ({
    kind: file.split("/")[1] as string,
    file,
    data: JSON.parse(readFileSync(file, "utf8")),
  })),
);
const actions = content.all(ACTIONS).map((a) => (a.id === "trade" ? { ...a, ease: 100 } : a));
const catalog = new ActionCatalog(actions);
const skills = new SkillCatalog(content.all(SKILLS), actions);
const clock = EARTHLIKE_CLOCK;
const buyers = [makeId("agent", 1), makeId("agent", 2)] as const;
const seller = makeId("agent", 3);
const good = ledgerUnit("good:tool");
const coin = ledgerUnit("coin:copper");
const goods = [{ id: "tool", name: "herramienta", form: "good", priceCopperPerKg: 4 }] as GoodDef[];
const map: LocalMap = {
  cell: makeId("cell", 1),
  lonDeg: 0,
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

function world(
  stock: number,
  serial = true,
  reverse = false,
  single = false,
  sharedHome = false,
  projectWatchExposures = false,
  economicVerbs?: readonly ("trade" | "give")[],
  workshop = false,
) {
  const truth = new WorldTruth();
  const log = new EventLog();
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
  const bodyPlan = content.all(BODY_PLANS)[0];
  if (!bodyPlan) throw new Error("sin body plan");
  const secondSeller = makeId("agent", 4);
  const sellerHome = makeId("household", 3);
  for (const actor of [...buyers, seller, ...(sharedHome ? [secondSeller] : [])]) {
    truth.set(ENTITY, actor, { id: actor, createdAt: 0, originEventId: makeId("event", 1) });
    truth.setRaw(PERSON.name, actor, {
      born: -30 * clock.year,
      sex: "male",
      household: sharedHome && actor === secondSeller ? sellerHome : `household:${actor.slice(6)}`,
    });
    truth.set(INNATE, actor, Object.fromEntries(content.all(TRAITS).map((t) => [t.id, t.mean])));
    truth.set(BODY_STATE, actor, newBody(bodyPlan, 55, 0));
    truth.set(LOCATION, actor, {
      hex: sharedHome && (actor === buyers[1] || actor === secondSeller) ? 1 : 0,
    });
  }
  truth.setRaw(PLACE.name, makeId("place", 1), { name: "plaza", kind: "village", hexes: [0] });
  if (sharedHome)
    truth.setRaw(PLACE.name, makeId("place", 2), {
      name: "otra plaza",
      kind: "village",
      hexes: [1],
    });
  const ledger = new Ledger({
    externals: {
      seed: [good, coin],
      [WORKSHOP]: [ledgerUnit("good:output")],
      [WORKSHOP_WASTE]: [good],
    },
  });
  ledger.post({
    tick: 0,
    eventId: makeId("event", 1),
    transfers: [
      {
        unit: good,
        from: externalAccount("seed"),
        to: holderAccount(sharedHome ? sellerHome : seller),
        amount: stock,
      },
      ...buyers.map((buyer) => ({
        unit: coin,
        from: externalAccount("seed"),
        to: holderAccount(buyer),
        amount: 100,
      })),
    ],
  });
  const opts: ActOptions = {
    ...(workshop ? { economicBatch: true } : {}),
    ...(economicVerbs ? { serialEconomicVerbs: economicVerbs } : {}),
    projectWatchExposures,
    serialTrades: serial,
    projectTrades: true,
    map: sharedHome
      ? { ...map, neighbors: [[1], [0]], crossSeconds: [1, 1], forest: [false, false] }
      : map,
    spaces: { spaces: [], edges: [] },
    catalog,
    skills,
    traits: content.all(TRAITS),
    bodyPlans: content.all(BODY_PLANS),
    goods,
    foods: [],
    recipes: [],
    statuses: [],
    clock,
    seed: 7,
    player: makeId("agent", 99),
  };
  const scheduler = new Scheduler({
    rng: Rng.root(7),
    clock,
    truth,
    log,
    ledger,
    ids: new IdAllocator({ event: 2, agent: sharedHome ? 5 : 4 }),
    resolution: "local",
    processes: [
      actProcess(opts),
      tradeProjectionProcess({ clock, goods }),
      ...(projectWatchExposures ? [watchingProjectionProcess({ catalog: skills, clock })] : []),
      ...(workshop
        ? [
            tradesProcess({
              economicBatch: true,
              clock,
              goods: [
                ...goods,
                { id: "copper", name: "cobre", form: "coin" },
                { id: "output", name: "producto", form: "good", priceCopperPerKg: 12 },
              ],
              recipes: [
                {
                  id: "consume-tool",
                  name: "oficio",
                  hoursPerBatch: 4,
                  inputs: [{ good: "tool", amount: 1000 }],
                  output: { good: "output", amount: 1000 },
                },
              ],
              assignments: [{ household: "household:3", recipe: "consume-tool" }],
              placeOf: () => place,
            }),
          ]
        : []),
    ],
  });
  for (const actor of single ? [buyers[1]] : reverse ? [...buyers].reverse() : buyers) {
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
          verb: "trade",
          args: [
            { role: "with", entity: sharedHome && actor === buyers[1] ? secondSeller : seller },
            { role: "what", text: "herramienta 1 kg" },
          ],
          manner: [],
        },
        manner: [],
        causes: [],
      },
    });
    scheduler.schedule({
      at: workshop ? clock.day : clock.day / 2,
      phase: "act",
      process: "life.act",
      scope: actor,
      reason: { kind: "state", entity: actor, key: planKey(1) },
    });
  }
  return { truth, log, ledger, scheduler, opts };
}

describe("trade real en lote opt-in", () => {
  it.each([2000, 1000])(
    "comparte vendedor con stock=%s sin doble débito ni perder agenda",
    (stock) => {
      const w = world(stock);
      w.scheduler.advanceTo(clock.day / 2);
      const trades = w.log.all().filter((e) => e.kind === "action.trade");
      expect(trades).toHaveLength(2);
      expect(w.scheduler.state().queue).toHaveLength(2);
      expect(w.truth.get(PLAN_STATE, buyers[0])?.steps).toHaveLength(1);
      expect(w.truth.get(PLAN_STATE, buyers[1])?.steps).toHaveLength(1);
      expect(w.ledger.total(good)).toBe(stock);
      expect(w.ledger.total(coin)).toBe(200);
      expect(w.ledger.balance(holderAccount(seller), good)).toBe(0);
      expect(w.ledger.balance(holderAccount(buyers[0]), good)).toBe(1000);
      expect(w.ledger.balance(holderAccount(buyers[1]), good)).toBe(stock - 1000);
      if (stock === 1000)
        expect((trades[1]?.data as { effect?: { deal: boolean } } | undefined)?.effect?.deal).toBe(
          false,
        );
      expect(w.ledger.audit()).toEqual([]);
    },
  );
  it("orden de llegada a queue no altera estado, registro ni saldos", () => {
    const a = world(2000);
    const b = world(2000, true, true);
    a.scheduler.advanceTo(clock.day / 2);
    b.scheduler.advanceTo(clock.day / 2);
    expect(a.truth.rows()).toEqual(b.truth.rows());
    expect(a.log.all()).toEqual(b.log.all());
    expect(a.ledger.balances()).toEqual(b.ledger.balances());
  });
  it("omitir opt-in conserva ausencia de lote en act", () => {
    const { opts } = world(2000, false);
    expect(actProcess(opts).serialGroup).toBeUndefined();
  });
  it("dos mercados diferentes ven actualizado el mismo granero debitado", () => {
    const w = world(1000, true, false, false, true);
    w.scheduler.advanceTo(clock.day / 2);
    expect(w.ledger.balance(holderAccount(buyers[0]), good)).toBe(1000);
    expect(w.ledger.balance(holderAccount(buyers[1]), good)).toBe(0);
    expect(w.ledger.balance(holderAccount(makeId("household", 3)), good)).toBe(0);
    expect(w.log.all().filter((e) => e.kind === "action.trade")).toHaveLength(2);
    expect(w.scheduler.state().queue).toHaveLength(2);
    expect(w.ledger.audit()).toEqual([]);
  });
  it.each(["speak", "strike", "work"])("no agrupa la hoja %s como trade", (verb) => {
    const { truth, opts } = world(2000);
    const state = truth.get(PLAN_STATE, buyers[0]);
    if (!state) throw new Error("sin plan");
    truth.set(PLAN_STATE, buyers[0], {
      ...state,
      plan: { ...state.plan, root: { kind: "do", verb, args: [], manner: [] } },
    });
    expect(
      actProcess(opts).serialGroup?.({
        truth,
        scope: buyers[0],
        now: clock.day / 2,
        item: { reason: { kind: "state", entity: buyers[0], key: planKey(1) } },
      } as unknown as ProcessContext),
    ).toBeUndefined();
  });
  it("un único trade mantiene exactamente los efectos, eventos, ledger y agenda de act directo", () => {
    const a = world(2000, true, false, true);
    const b = world(2000, false, false, true);
    a.scheduler.advanceTo(clock.day / 2);
    b.scheduler.advanceTo(clock.day / 2);
    expect(a.truth.rows()).toEqual(b.truth.rows());
    expect(a.log.all()).toEqual(b.log.all());
    expect(a.ledger.journal()).toEqual(b.ledger.journal());
    expect(a.scheduler.state()).toEqual(b.scheduler.state());
  });
  it("dos acciones directas comparten testigos sin disputar skill/opinion al proyectarlas", () => {
    const w = world(2000, false, false, false, false, true);
    expect(() => w.scheduler.advanceTo(clock.day / 2)).not.toThrow();
    const trades = w.log.all().filter((e) => e.kind === "action.trade");
    expect(trades).toHaveLength(2);
    expect(w.scheduler.state().queue).toHaveLength(2);
    expect(
      trades.some((e) => (e.data as { watchExposures?: unknown[] }).watchExposures?.length),
    ).toBe(true);
    expect(w.log.all().filter((e) => e.kind === "contest")).toHaveLength(0);
    expect(w.ledger.audit()).toEqual([]);
  });
  it("capturar exposiciones conserva efectos de una acción aislada y las emisiones originales", () => {
    const direct = world(2000, false, false, true, false, false);
    const projected = world(2000, false, false, true, false, true);
    direct.scheduler.advanceTo(clock.day / 2);
    projected.scheduler.advanceTo(clock.day / 2);
    expect(projected.truth.rows()).toEqual(direct.truth.rows());
    const withoutPacket = projected.log.all().map((event) => {
      if (event.kind !== "action.trade") return event;
      const { watchExposures, ...data } = event.data as { watchExposures?: unknown[] };
      expect(watchExposures?.length).toBeGreaterThan(0);
      return { ...event, data };
    });
    expect(withoutPacket).toEqual(direct.log.all());
  });
  it.each([false, true])(
    "trade y give comparten bolsillo sin doble débito (giverFirst=%s)",
    (giverFirst) => {
      const w = world(1000, true, false, true, false, true, ["trade", "give"]);
      const giver = giverFirst ? buyers[0] : seller;
      const recipient = giverFirst ? seller : buyers[0];
      if (giverFirst)
        w.ledger.post({
          tick: 0,
          eventId: makeId("event", 1),
          transfers: [
            { unit: good, from: holderAccount(seller), to: holderAccount(giver), amount: 1000 },
          ],
        });
      const buyerPlan = w.truth.get(PLAN_STATE, buyers[1]);
      if (!buyerPlan) throw new Error("sin plan de trade");
      w.truth.set(PLAN_STATE, buyers[1], {
        ...buyerPlan,
        plan: {
          ...buyerPlan.plan,
          root: {
            kind: "do",
            verb: "trade",
            args: [
              { role: "with", entity: giver },
              { role: "what", text: "herramienta 1 kg" },
            ],
            manner: [],
          },
        },
      });
      w.truth.set(PLAN_STATE, giver, {
        seq: 1,
        done: false,
        cursor: FRESH_CURSOR,
        lastBelieved: null,
        steps: [],
        plan: {
          actor: giver,
          source: "utility",
          root: {
            kind: "do",
            verb: "give",
            args: [
              { role: "to", entity: recipient },
              { role: "what", text: "herramienta 1 kg" },
            ],
            manner: [],
          },
          manner: [],
          causes: [],
        },
      });
      w.scheduler.schedule({
        at: clock.day / 2,
        phase: "act",
        process: "life.act",
        scope: giver,
        reason: { kind: "state", entity: giver, key: planKey(1) },
      });
      expect(() => w.scheduler.advanceTo(clock.day / 2)).not.toThrow();
      expect(
        w.log.all().filter((e) => e.kind === "action.trade" || e.kind === "action.give"),
      ).toHaveLength(2);
      expect(w.truth.get(PLAN_STATE, giver)?.steps).toHaveLength(1);
      expect(w.truth.get(PLAN_STATE, buyers[1])?.steps).toHaveLength(1);
      expect(w.scheduler.state().queue).toHaveLength(2);
      expect(w.ledger.balance(holderAccount(giver), good)).toBe(0);
      expect(w.ledger.balance(holderAccount(recipient), good)).toBe(giverFirst ? 1000 : 0);
      expect(w.ledger.balance(holderAccount(buyers[1]), good)).toBe(giverFirst ? 0 : 1000);
      expect(w.ledger.audit()).toEqual([]);
      const failed = w.log
        .all()
        .find((event) => event.kind === (giverFirst ? "action.trade" : "action.give"));
      if (giverFirst)
        expect((failed?.data as { effect?: { deal: boolean } } | undefined)?.effect?.deal).toBe(
          false,
        );
      else
        expect((failed?.data as { effect?: { grams: number } } | undefined)?.effect?.grams).toBe(0);
      w.scheduler.advanceTo(clock.day);
      expect(w.truth.get(PLAN_STATE, giver)?.done).toBe(true);
      expect(w.truth.get(PLAN_STATE, buyers[1])?.done).toBe(true);
      expect(w.scheduler.state().queue).toEqual([]);
    },
  );
  it.each([1000, 2000])("taller y trade comparten reservas con stock=%s", (stock) => {
    const w = world(stock, true, false, true, true, true, ["trade", "give"], true);
    expect(() => w.scheduler.advanceTo(clock.day)).not.toThrow();
    expect(w.log.all().some((e) => e.kind === "household.produced")).toBe(stock === 2000);
    expect(w.log.all().some((e) => e.kind === "action.trade")).toBe(true);
    expect(w.ledger.balance(holderAccount(buyers[1]), good)).toBe(1000);
    expect(w.ledger.total(ledgerUnit("good:output"))).toBe(stock - 1000);
    expect(w.ledger.balance(holderAccount(makeId("household", 3)), good)).toBe(0);
    expect(w.truth.get(PLAN_STATE, buyers[1])?.steps).toHaveLength(1);
    expect(w.scheduler.state().queue).toHaveLength(1);
    expect(w.ledger.audit()).toEqual([]);
  });
});
