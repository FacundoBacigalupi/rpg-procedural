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
  draftEvent,
  ENTITY,
  type GoodDef,
  PERSON,
  PERSON_CULTURE,
  type ProcessDef,
  Scheduler,
  TRAITS,
  WorldTruth,
} from "../../sim/index.ts";
import { derivedLoanUsury } from "./create.ts";
import { ECONOMIC_SERIAL_DOMAIN, ECONOMIC_SERIAL_GROUP } from "./economic-batch.ts";
import { LOANS, loansProcess } from "./loans.ts";

const file = "content/traits/human.json";
const content = loadContent(
  [TRAITS],
  [{ kind: "traits", file, data: JSON.parse(readFileSync(file, "utf8")) }],
);
const tools = ledgerUnit("good:tool"),
  coin = ledgerUnit("coin:copper");
const home = makeId("household", 1),
  receiver = makeId("household", 2),
  shop = makeId("household", 3);
const place = { kind: "settlement", settlement: makeId("settlement", 1) } as const;
const goods = [
  { id: "tool", name: "herramienta", form: "good", priceCopperPerKg: 4 },
  { id: "copper", name: "cobre", form: "coin" },
] as GoodDef[];

function world(batch: boolean, priorMember: boolean, newHolder = false) {
  const truth = new WorldTruth(),
    log = new EventLog();
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
  for (const n of [1, 2, 3]) {
    const actor = makeId("agent", n),
      household = makeId("household", n);
    for (const id of [actor, household])
      truth.set(ENTITY, id, { id, createdAt: 0, originEventId: makeId("event", 1) });
    truth.setRaw(PERSON.name, actor, { sex: "male", born: -30 * clock.year, household });
  }
  truth.setRaw(PERSON_CULTURE.name, makeId("agent", 1), {
    holdings: { "norms.interest": { variant: "forbidden", shown: "forbidden", strength: 1 } },
    identity: [],
    originEventId: makeId("event", 1),
  });
  if (newHolder)
    truth.setRaw(
      PERSON_CULTURE.name,
      makeId("agent", 2),
      truth.getRaw(PERSON_CULTURE.name, makeId("agent", 1)),
    );
  const ledger = new Ledger({ externals: { seed: [tools, coin] } });
  ledger.post({
    tick: 0,
    eventId: makeId("event", 1),
    transfers: [
      { unit: tools, from: externalAccount("seed"), to: holderAccount(home), amount: 1000 },
      { unit: coin, from: externalAccount("seed"), to: holderAccount(home), amount: 100 },
      ...(newHolder
        ? [{ unit: coin, from: externalAccount("seed"), to: holderAccount(receiver), amount: 20 }]
        : []),
    ],
  });
  const usury = derivedLoanUsury({ interestNorm: { variants: { forbidden: 1 } } }, content, ledger);
  if (!usury) throw new Error("sin usura derivada");
  const prior: ProcessDef = {
    id: "life.aaa_spent",
    system: "life",
    scope: "world",
    phase: "act",
    representation: "individual",
    cadence: { local: "day" },
    reads: [],
    writes: [],
    serialDomain: ECONOMIC_SERIAL_DOMAIN,
    serialGroup: () => ECONOMIC_SERIAL_GROUP,
    run(ctx) {
      if (ctx.now !== clock.day) return {};
      return {
        events: [
          {
            kind: "fixture.spent",
            actors: [makeId("agent", 1), makeId("agent", 3)],
            place,
            data: {},
            emissions: {},
            causes: [{ kind: "event", event: makeId("event", 1) }],
          },
        ],
        postings: [
          {
            event: draftEvent(0),
            transfers: [
              { unit: tools, from: holderAccount(home), to: holderAccount(shop), amount: 1000 },
            ],
          },
        ],
      };
    },
  };
  const first = {
    id: "a-tools",
    lender: home,
    borrower: receiver,
    good: "tool",
    principal: 1000,
    rate: 0.1,
    startDay: 1,
    termDays: 10,
  };
  const second = {
    id: "b-coin",
    lender: newHolder ? receiver : home,
    borrower: newHolder ? shop : receiver,
    good: "copper",
    principal: 10,
    rate: 0.1,
    startDay: 1,
    termDays: 10,
  };
  const scheduler = new Scheduler({
    truth,
    log,
    ledger,
    clock,
    rng: Rng.root(7),
    ids: new IdAllocator({ event: 2, commitment: 1, agent: 4, household: 4 }),
    resolution: "local",
    processes: [
      ...(priorMember ? [prior] : []),
      loansProcess({
        economicBatch: batch,
        clock,
        goods,
        seeds: priorMember ? [second] : [first, second],
        usury,
        placeOf: () => place,
      }),
    ],
  });
  return { truth, log, ledger, scheduler };
}

describe("usura derivada con contexto de reservas", () => {
  it("enumera una unidad nueva recibida por el futuro prestamista dentro del mismo run", () => {
    const opted = world(true, false, true),
      legacy = world(false, false, true);
    opted.scheduler.advanceTo(clock.day);
    legacy.scheduler.advanceTo(clock.day);
    expect(opted.truth.ids(LOANS)).toHaveLength(2);
    expect(legacy.truth.ids(LOANS)).toHaveLength(1);
    expect(opted.ledger.balance(holderAccount(shop), coin)).toBe(10);
    expect(opted.ledger.total(coin)).toBe(120);
    expect(opted.ledger.total(tools)).toBe(1000);
    expect(opted.ledger.audit()).toEqual([]);
  });
  it.each([true, false])(
    "evita stock capturado %s: miembros anteriores o asientos internos",
    (priorMember) => {
      const legacy = world(false, priorMember),
        opted = world(true, priorMember);
      legacy.scheduler.advanceTo(clock.day);
      opted.scheduler.advanceTo(clock.day);
      expect(
        legacy.log
          .all()
          .some(
            (e) => e.kind === "credit.loaned" && (e.data as { seed?: string }).seed === "b-coin",
          ),
      ).toBe(true);
      expect(
        opted.log
          .all()
          .some(
            (e) => e.kind === "credit.loaned" && (e.data as { seed?: string }).seed === "b-coin",
          ),
      ).toBe(false);
      expect(opted.truth.ids(LOANS)).toHaveLength(priorMember ? 0 : 1);
      expect(opted.ledger.balance(holderAccount(home), coin)).toBe(100);
      expect(opted.ledger.balance(holderAccount(home), tools)).toBe(0);
      expect(opted.ledger.total(coin)).toBe(100);
      expect(opted.ledger.total(tools)).toBe(1000);
      expect(opted.ledger.audit()).toEqual([]);
      const repeated = world(true, priorMember);
      repeated.scheduler.advanceTo(clock.day);
      expect(opted.truth.rows()).toEqual(repeated.truth.rows());
      expect(opted.log.all()).toEqual(repeated.log.all());
      expect(opted.ledger.journal()).toEqual(repeated.ledger.journal());
    },
  );
});
