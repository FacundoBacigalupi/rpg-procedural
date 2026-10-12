import { describe, expect, it } from "vitest";
import { EARTHLIKE_CLOCK, EventLog, IdAllocator, makeId, Rng } from "../../core/index.ts";
import {
  draftEvent,
  type GoodDef,
  learnFromDeal,
  MARKET_TAPE,
  noteSeller,
  PERSON,
  PRICE_BELIEFS,
  type ProcessContext,
  type ProcessDef,
  recordDeal,
  SALE_RECEIPTS,
  Scheduler,
  SELLER_DAY,
  setComponent,
  type TapeEntry,
  table,
  WorldTruth,
} from "../../sim/index.ts";
import { tradeProjectionProcess } from "./trade-projection.ts";

const clock = EARTHLIKE_CLOCK;
const goods = [{ id: "grain", name: "grano", form: "good", priceCopperPerKg: 4 }] as GoodDef[];
const market = makeId("settlement", 1);
const buyer1 = makeId("agent", 1);
const buyer2 = makeId("agent", 2);
const seller = makeId("agent", 3);
const home = makeId("household", 1);
const observer = makeId("agent", 4);
const progress = table<{ done: boolean }>("test.trade_progress");
const entry = (buyer: typeof buyer1): TapeEntry => ({
  day: 1,
  unit: "good:grain",
  grams: 1000,
  coins: 4,
  seller,
  buyer,
});

function trader(buyer: typeof buyer1): ProcessDef {
  return {
    id: `test.trade.${buyer}`,
    system: "test",
    scope: "world",
    cadence: { local: "day" },
    representation: "individual",
    phase: "act",
    reads: [],
    writes: [progress.name],
    run(ctx) {
      return {
        changes: [setComponent(progress, buyer, { done: true })],
        events: [
          {
            kind: "action.trade",
            actors: [buyer, seller],
            place: { kind: "settlement", settlement: market },
            causes: [{ kind: "seed" }],
            emissions: {},
            data: {
              effect: {
                kind: "trade",
                deal: true,
                direction: "buy",
                good: "good:grain",
                grams: 1000,
                coins: 4,
                with: seller,
              },
              marketProjection: { market, witnesses: [observer] },
            },
          },
        ],
        schedule: [
          {
            at: ctx.now + clock.day,
            phase: "act",
            process: `test.trade.${buyer}`,
            scope: "world",
            reason: { kind: "event", event: draftEvent(0) },
          },
        ],
      };
    },
  };
}

function world(reverse = false) {
  const truth = new WorldTruth();
  truth.setRaw(PERSON.name, seller, { household: home });
  const log = new EventLog();
  const processes = [trader(buyer1), trader(buyer2), tradeProjectionProcess({ clock, goods })];
  const scheduler = new Scheduler({
    truth,
    log,
    ids: new IdAllocator(),
    rng: Rng.root(7),
    clock,
    resolution: "local",
    processes: reverse ? processes.reverse() : processes,
  });
  return { truth, log, scheduler };
}

describe("proyección de trades simultáneos", () => {
  it("dos tratos independientes comparten cinta/testigo/vendedor sin perder avances", () => {
    const w = world();
    expect(() => w.scheduler.advanceTo(clock.day)).not.toThrow();
    expect(w.truth.get(progress, buyer1)?.done).toBe(true);
    expect(w.truth.get(progress, buyer2)?.done).toBe(true);
    expect(w.scheduler.state().queue).toHaveLength(2);
    const tape = recordDeal(recordDeal([], entry(buyer1)), entry(buyer2));
    expect(w.truth.get(MARKET_TAPE, market)).toEqual(tape);
    expect(w.truth.get(PRICE_BELIEFS, observer)).toEqual(
      learnFromDeal(
        learnFromDeal(undefined, entry(buyer1), 4, "witness"),
        entry(buyer2),
        4,
        "witness",
      ),
    );
    expect(w.truth.get(SELLER_DAY, seller)).toEqual(
      noteSeller(noteSeller(undefined, 1, "good:grain", 1000, 1000), 1, "good:grain", 1000, 1000),
    );
    expect(w.truth.get(SALE_RECEIPTS, home)?.receipts.reduce((n, r) => n + r.coins, 0)).toBe(8);
    expect(w.log.all().filter((e) => e.kind === "contest")).toHaveLength(0);
  });

  it("orden de registro de procesos no cambia resultados", () => {
    const a = world();
    const b = world(true);
    a.scheduler.advanceTo(clock.day);
    b.scheduler.advanceTo(clock.day);
    expect(a.truth.rows()).toEqual(b.truth.rows());
    expect(a.log.all()).toEqual(b.log.all());
  });

  it("ignora eventos legacy sin metadata opt-in", () => {
    const out = tradeProjectionProcess({ clock, goods }).run({
      truth: new WorldTruth(),
      recent: [
        {
          kind: "action.trade",
          tick: clock.day,
          id: makeId("event", 1),
          actors: [buyer1],
          data: {},
        },
      ],
    } as unknown as ProcessContext);
    expect(out.changes).toEqual([]);
  });
});
