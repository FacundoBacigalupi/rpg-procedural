import { describe, expect, it } from "vitest";
import {
  EARTHLIKE_CLOCK,
  externalAccount,
  type HolderRef,
  holderAccount,
  Ledger,
  ledgerUnit,
  makeId,
} from "../../core/index.ts";
import {
  ENTITY,
  type GoodDef,
  PERSON,
  type ProcessContext,
  TRADE_RECEIPTS,
  type TradeRecipeDef,
  WORKSHOP,
  WORKSHOP_WASTE,
  WorldTruth,
} from "../../sim/index.ts";
import { incomeOfHousehold, tradeOfHousehold, tradesProcess } from "./trades.ts";

const goods = [
  { id: "copper", name: "cobre", form: "coin" },
  { id: "wool", name: "lana", form: "good", priceCopperPerKg: 18, halfLifeDays: 1500 },
  { id: "cloth", name: "paño", form: "good", priceCopperPerKg: 40, halfLifeDays: 3000 },
] as unknown as GoodDef[];
const recipes: TradeRecipeDef[] = [
  {
    id: "weave",
    name: "tejer",
    hoursPerBatch: 4,
    inputs: [{ good: "wool", amount: 1000 }],
    output: { good: "cloth", amount: 800 },
  },
];
const U = (g: string) => ledgerUnit(g === "copper" ? "coin:copper" : `good:${g}`);

describe("life.trades", () => {
  const clock = EARTHLIKE_CLOCK;
  function setup() {
    const truth = new WorldTruth();
    const ledger = new Ledger({
      externals: {
        seed: [U("copper"), U("wool")],
        [WORKSHOP]: [U("cloth")],
        [WORKSHOP_WASTE]: [U("wool")],
      },
    });
    const person = (n: number, home: string) => {
      const id = makeId("agent", n);
      truth.set(ENTITY, id, { id, originEventId: makeId("event", 1), createdAt: 0 } as never);
      truth.set(PERSON, id, { born: -30 * clock.year, household: home } as never);
      return id;
    };
    person(1, "weaver");
    person(2, "farm");
    ledger.post({
      tick: 0,
      eventId: makeId("event", 1),
      transfers: [
        {
          unit: U("wool"),
          from: externalAccount("seed"),
          to: holderAccount("weaver" as unknown as HolderRef),
          amount: 3000,
        },
        {
          unit: U("copper"),
          from: externalAccount("seed"),
          to: holderAccount("weaver" as unknown as HolderRef),
          amount: 100,
        },
      ],
    });
    return { truth, ledger };
  }
  const total = (l: Ledger, u: string) =>
    ["weaver", "farm", makeId("agent", 1), makeId("agent", 2)]
      .map((h) => l.balance(holderAccount(h as unknown as HolderRef), U(u)))
      .reduce((a, b) => a + b, 0);

  it("produce con horas libres, contrata y conserva", () => {
    const { truth, ledger } = setup();
    const proc = tradesProcess({
      clock,
      goods,
      recipes,
      assignments: [{ household: "weaver", recipe: "weave" }],
      placeOf: () => ({ kind: "cell" }) as never,
    });
    const ctx = {
      truth,
      ledger,
      now: 10 * clock.day,
      window: clock.day,
    } as unknown as ProcessContext;
    const r = proc.run(ctx);
    expect(r.events?.length).toBe(1);
    expect(r.postings?.length).toBe(1);
    const before = { wool: total(ledger, "wool"), copper: total(ledger, "copper") };
    for (const p of r.postings ?? [])
      ledger.post({ tick: ctx.now, eventId: makeId("event", 2), transfers: p.transfers });
    // Monedas conservadas entre hogares; la lana se consumió y salió paño.
    expect(total(ledger, "copper")).toBe(before.copper);
    expect(total(ledger, "wool")).toBeLessThan(before.wool);
    expect(total(ledger, "cloth")).toBeGreaterThan(0);
    // El hogar del jornalero tiene recibo y ingreso medio positivo.
    const changes = r.changes ?? [];
    expect(changes.some((c) => (c as { table?: string }).table === TRADE_RECEIPTS.name)).toBe(true);
  });

  it("sin asignaciones no hace nada", () => {
    const { truth, ledger } = setup();
    const proc = tradesProcess({
      clock,
      goods,
      recipes,
      assignments: [],
      placeOf: () => ({}) as never,
    });
    expect(
      proc.run({ truth, ledger, now: 5, window: clock.day } as unknown as ProcessContext),
    ).toEqual({});
    expect(incomeOfHousehold(truth, "farm", 5)).toBe(0);
  });
});

describe("oficio de un hogar desde la población", () => {
  const homes = Array.from({ length: 200 }, (_, i) => `household:${i}`);
  it("es determinista y solo toca a unos pocos hogares con manos de sobra", () => {
    const a = homes.map((h) => tradeOfHousehold(7, h, 3, recipes)?.id);
    const b = homes.map((h) => tradeOfHousehold(7, h, 3, recipes)?.id);
    expect(a).toEqual(b);
    const n = a.filter((x) => x !== undefined).length;
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(homes.length / 4);
    expect(homes.every((h) => tradeOfHousehold(7, h, 1, recipes) === undefined)).toBe(true);
  });
});

describe("elección de oficio por habilidad y necesidad", () => {
  it("elige por puntaje, la necesidad empuja y sin habilidad o manos no hay oficio", async () => {
    const m = await import("./trades.ts");
    const c = [
      { recipe: "b", skill: 0.8, marginPerHour: 10 },
      { recipe: "a", skill: 0.8, marginPerHour: 10 },
      { recipe: "z", skill: 0.05, marginPerHour: 99 },
    ];
    expect(m.chooseTradeBySkill(2, c, 0)).toBe("a");
    expect(m.chooseTradeBySkill(1, c, 1)).toBeUndefined();
    expect(m.chooseTradeBySkill(2, [c[2] as (typeof c)[number]], 1)).toBeUndefined();
    expect(m.tradeScore(c[0] as (typeof c)[number], 1)).toBeGreaterThan(
      m.tradeScore(c[0] as (typeof c)[number], 0),
    );
    expect(
      m.recipeMarginPerHour(recipes[0] as TradeRecipeDef, (g) => (g === "wool" ? 0.018 : 0.04)),
    ).toBeCloseTo((800 * 0.04 - 1000 * 0.018) / 4);
  });
});
