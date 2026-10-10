import { describe, expect, it } from "vitest";
import {
  EARTHLIKE_CLOCK,
  externalAccount,
  type HolderRef,
  holderAccount,
  Ledger,
  ledgerUnit,
  makeId,
  Rng,
} from "../../core/index.ts";
import {
  BUILDING,
  ENTITY,
  type GoodDef,
  PERSON,
  type ProcessContext,
  WorldTruth,
} from "../../sim/index.ts";
import { FAMINE } from "./famineRow.ts";
import { MIGRATION_PREP_DAYS, MIGRATIONS, migrationProcess } from "./migration.ts";

const clock = EARTHLIKE_CLOCK;
const goods = [
  { id: "grain", name: "grano", form: "good", priceCopperPerKg: 4, halfLifeDays: 400 },
] as unknown as GoodDef[];
const GRAIN = ledgerUnit("good:grain");

function setup(pull: number) {
  const truth = new WorldTruth();
  const ledger = new Ledger({ externals: { seed: [GRAIN] } });
  const person = makeId("agent", 1);
  truth.set(ENTITY, person, {
    id: person,
    originEventId: makeId("event", 1),
    createdAt: 0,
  } as never);
  truth.set(PERSON, person, { born: -30 * clock.year, household: "h1" } as never);
  for (const [n, home, s] of [
    [10, "h1", "s1"],
    [11, "h2", "s2"],
  ] as const) {
    const id = makeId("building", n);
    truth.set(ENTITY, id, { id, originEventId: makeId("event", 1), createdAt: 0 } as never);
    truth.set(BUILDING, id, { household: home, settlement: s } as never);
  }
  ledger.post({
    tick: 0,
    eventId: makeId("event", 1),
    transfers: [
      {
        unit: GRAIN,
        from: externalAccount("seed"),
        to: holderAccount("h1" as unknown as HolderRef),
        amount: 1000,
      },
    ],
  });
  truth.set(FAMINE, "s1" as never, {
    state: pull > 0 ? "famine" : "none",
    value: 0.9,
    since: 0,
    pricePush: 2,
    migrationPull: pull,
  });
  return { truth, ledger, person };
}

const make = () =>
  migrationProcess({
    clock,
    goods,
    staple: "grain",
    attachment: () => 0,
    placeOf: () => ({ kind: "cell" }) as never,
  });
const ctxOf = (truth: WorldTruth, ledger: Ledger, day: number, seed = 7) =>
  ({
    truth,
    ledger,
    now: day * clock.day,
    window: clock.day,
    rng: Rng.root(seed),
  }) as unknown as ProcessContext;

/** Primer día en que el hogar decide irse (la tirada es por hogar y día). */
function firstDecision(pull: number) {
  const { truth, ledger } = setup(pull);
  for (let day = 1; day < 200; day++) {
    const out = make().run(ctxOf(truth, ledger, day));
    if (out.events?.length) return { day, out, truth, ledger };
  }
  return undefined;
}

describe("life.migration", () => {
  it("un hogar con migrationPull alto decide irse con evento causal y fila", () => {
    const d = firstDecision(1);
    expect(d).toBeDefined();
    if (!d) return;
    const [ev] = d.out.events ?? [];
    expect(ev?.kind).toBe("migration.decided");
    expect(ev?.causes).toEqual([{ kind: "state", entity: "s1", key: "food-scarcity" }]);
    expect(ev?.data).toMatchObject({ household: "h1", from: "s1", to: "s2" });
    const change = d.out.changes?.[0] as unknown as {
      key: string;
      value: { from: string; to: string; departsOn: number; state: string };
    };
    expect(change.value).toMatchObject({
      from: "s1",
      to: "s2",
      decidedOn: d.day,
      departsOn: d.day + MIGRATION_PREP_DAYS,
      state: "leaving",
    });
    expect(MIGRATIONS.name).toBe("economy.migrations");
  });

  it("sin hambruna (sin empuje) no hace nada", () => {
    const { truth, ledger } = setup(0);
    for (let day = 1; day < 100; day++) {
      expect(make().run(ctxOf(truth, ledger, day))).toEqual({});
    }
  });

  it("es determinista: mismo seed, mismas decisiones", () => {
    const a = firstDecision(1);
    const b = firstDecision(1);
    expect(a?.day).toBe(b?.day);
    expect(a?.out).toEqual(b?.out);
  });

  it("un hogar que ya está yéndose no vuelve a decidir", () => {
    const d = firstDecision(1);
    if (!d) throw new Error("sin decisión");
    const ch = d.out.changes?.[0] as unknown as { value: never };
    d.truth.set(MIGRATIONS, "h1" as never, ch.value);
    expect(make().run(ctxOf(d.truth, d.ledger, d.day + 1))).toEqual({});
  });
});
