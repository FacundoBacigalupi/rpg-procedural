import { describe, expect, it } from "vitest";
import {
  EARTHLIKE_CLOCK as clock,
  EventLog,
  externalAccount,
  holderAccount,
  IdAllocator,
  Ledger,
  ledgerUnit,
  makeId,
  Rng,
} from "../../core/index.ts";
import {
  draftEvent,
  ENTITY,
  type GoodDef,
  HOUSEHOLD,
  PERSON,
  type ProcessDef,
  Scheduler,
  WorldTruth,
} from "../../sim/index.ts";
import { COMMITMENTS, commitmentRows, LOANS, type LoanSeed, loansProcess } from "./loans.ts";
import { FULL_PROFILE } from "./profile.ts";

const coin = ledgerUnit("coin:copper"),
  grain = ledgerUnit("good:grain");
const lender = makeId("household", 1),
  borrower = makeId("household", 2),
  guarantor = makeId("household", 3),
  merchant = makeId("household", 4);
const pledge = makeId("lot", 1);
const place = { kind: "settlement", settlement: makeId("settlement", 1) } as const;
const goods = [
  { id: "copper", name: "cobre", form: "coin" },
  { id: "grain", name: "grano", form: "good", priceCopperPerKg: 4 },
] as GoodDef[];
const seed: LoanSeed = {
  id: "secured-existing-parties",
  lender,
  borrower,
  good: "copper",
  principal: 10,
  rate: 0.2,
  startDay: 1,
  termDays: 2,
  collateral: [
    {
      ref: pledge,
      believedValue: 2,
      trueValue: 2,
      heldBy: borrower,
      lot: { unit: grain, amount: 500 },
    },
  ],
  guarantors: [{ household: guarantor, share: 0.5 }],
};

function world(spend: boolean) {
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
  for (const n of [1, 2, 3, 4]) {
    const home = makeId("household", n),
      agent = makeId("agent", n);
    for (const id of [home, agent])
      truth.set(ENTITY, id, { id, createdAt: 0, originEventId: makeId("event", 1) });
    truth.setRaw(HOUSEHOLD.name, home, {});
    truth.setRaw(PERSON.name, agent, { born: -30 * clock.year, sex: "male", household: home });
  }
  truth.set(ENTITY, pledge, { id: pledge, createdAt: 0, originEventId: makeId("event", 1) });
  const ledger = new Ledger({ externals: { seed: [coin, grain] } });
  ledger.post({
    tick: 0,
    eventId: makeId("event", 1),
    transfers: [
      { unit: coin, from: externalAccount("seed"), to: holderAccount(lender), amount: 100 },
      { unit: coin, from: externalAccount("seed"), to: holderAccount(guarantor), amount: 20 },
      { unit: grain, from: externalAccount("seed"), to: holderAccount(borrower), amount: 500 },
    ],
  });
  const bondage = FULL_PROFILE.loanBondage;
  if (!bondage) throw new Error("perfil sin servidumbre");
  // Gastar el desembolso en otra fase: representa pago a un comerciante existente,
  // no inyecta saldo ni compite con el proceso de préstamo durante act.
  const purchase: ProcessDef = {
    id: "life.fixture_purchase",
    system: "life",
    scope: "world",
    phase: "physics",
    cadence: { local: "day" },
    representation: "individual",
    reads: [LOANS.name],
    writes: [],
    run(ctx) {
      if (ctx.now !== clock.day) return {};
      const id = ctx.truth.ids(LOANS)[0],
        loan = id ? ctx.truth.get(LOANS, id) : undefined;
      if (!loan) throw new Error("compra sin préstamo");
      return {
        events: [
          {
            kind: "fixture.purchased",
            actors: [makeId("agent", 2), makeId("agent", 4)],
            place,
            data: { coins: 10 },
            emissions: {},
            causes: [{ kind: "event", event: loan.originEventId as never }],
          },
        ],
        postings: [
          {
            event: draftEvent(0),
            transfers: [
              {
                unit: coin,
                from: holderAccount(borrower),
                to: holderAccount(merchant),
                amount: 10,
              },
            ],
          },
        ],
      };
    },
  };
  const scheduler = new Scheduler({
    truth,
    log,
    ledger,
    clock,
    rng: Rng.root(7),
    ids: new IdAllocator({ event: 2, commitment: 1, agent: 5, household: 5, lot: 2 }),
    resolution: "local",
    processes: [
      loansProcess({
        clock,
        goods,
        seeds: [seed],
        debtKnowledge: true,
        bondage: {
          wagePerDay: bondage.wagePerDay,
          upkeepPerDay: bondage.upkeepPerDay,
          maxDays: bondage.maxDays,
          ransom: bondage.ransom,
        },
        placeOf: () => place,
      }),
      ...(spend ? [purchase] : []),
    ],
  });
  return { truth, log, ledger, scheduler };
}

describe("préstamo garantizado con scheduler real", () => {
  it("abre entre partes existentes y cobra una cuota real conservando dinero y prenda", () => {
    const w = world(false);
    w.scheduler.advanceTo(clock.day);
    const id = w.truth.ids(LOANS)[0];
    if (!id) throw new Error("sin préstamo");
    const opened = w.log.all().find((e) => e.kind === "credit.loaned");
    expect(w.truth.get(ENTITY, id)?.originEventId).toBe(opened?.id);
    expect(w.truth.get(LOANS, id)?.originEventId).toBe(opened?.id);
    expect(w.ledger.balance(holderAccount(borrower), coin)).toBe(10);
    w.scheduler.advanceTo(2 * clock.day);
    expect(w.log.all().find((e) => e.kind === "credit.paid")?.data).toMatchObject({ paid: 10 });
    expect(w.ledger.balance(holderAccount(borrower), coin)).toBe(0);
    expect(w.ledger.total(coin)).toBe(120);
    expect(w.ledger.total(grain)).toBe(500);
    expect(w.ledger.audit()).toEqual([]);
  });
  it("vencimiento ejecuta el lote real y fiador, abre subrogación y servidumbre del perfil", () => {
    const w = world(true);
    w.scheduler.advanceTo(3 * clock.day);
    expect(w.ledger.balance(holderAccount(borrower), grain)).toBe(0);
    expect(w.ledger.balance(holderAccount(lender), grain)).toBe(500);
    expect(w.log.all().find((e) => e.kind === "credit.defaulted")?.data).toMatchObject({
      seized: [pledge],
      guarantorsPaid: [{ amount: 6 }],
      loss: 5,
    });
    expect(
      commitmentRows(w.truth)
        .map((r) => r.commitment.kind)
        .sort(),
    ).toEqual(["bondage", "loan", "subrogation"]);
    for (const row of commitmentRows(w.truth))
      expect(w.log.get(w.truth.get(ENTITY, row.id as never)?.originEventId as never)).toBeDefined();
    const bonded = w.log.all().find((e) => e.kind === "credit.bonded"),
      defaulted = w.log.all().find((e) => e.kind === "credit.defaulted");
    expect(bonded?.causes).toContainEqual({ kind: "event", event: defaulted?.id });
    w.scheduler.advanceTo(9 * clock.day);
    expect(w.log.all().filter((e) => e.kind === "credit.bondage_worked")).toHaveLength(5);
    expect(
      commitmentRows(w.truth).find((r) => r.commitment.kind === "bondage")?.commitment.status,
    ).toBe("fulfilled");
    expect(w.ledger.total(coin)).toBe(120);
    expect(w.ledger.total(grain)).toBe(500);
    expect(w.ledger.audit()).toEqual([]);
  });
  it("mismo seed y términos conservan origen, causas, contratos y asientos", () => {
    const a = world(true),
      b = world(true);
    a.scheduler.advanceTo(9 * clock.day);
    b.scheduler.advanceTo(9 * clock.day);
    expect(a.truth.rows()).toEqual(b.truth.rows());
    expect(a.log.all()).toEqual(b.log.all());
    expect(a.ledger.journal()).toEqual(b.ledger.journal());
    expect(a.truth.ids(COMMITMENTS)).toHaveLength(3);
  });
});
