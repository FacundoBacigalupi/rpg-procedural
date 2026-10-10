import { describe, expect, it } from "vitest";
import {
  type AgentId,
  EARTHLIKE_CLOCK,
  type Event,
  type EventId,
  EventLog,
  IdAllocator,
  ledgerUnit,
  Rng,
} from "../../core/index.ts";
import {
  BODY_STATE,
  CREDIT,
  ENTITY,
  lend,
  mediumGoals,
  PERSON,
  type ProcessContext,
  type ProcessDef,
  type ProcessResult,
  Scheduler,
  WorldTruth,
} from "../../sim/index.ts";
import { creditProcess } from "./credit.ts";
import {
  DEBT_BOOK,
  type DebtBelief,
  debtGoalInputs,
  debtKnowledgeProcess,
  observeCreditPayment,
} from "./debtknowledge.ts";

const debtor = "agent:1" as AgentId;
const creditor = "agent:2" as AgentId;
const stranger = "agent:3" as AgentId;
const grain = ledgerUnit("good:grain");
const origin = "event:1" as EventId;
const day = EARTHLIKE_CLOCK.day;
function fixture() {
  const truth = new WorldTruth();
  for (const who of [debtor, creditor, stranger]) {
    truth.set(ENTITY, who, { id: who, originEventId: origin, createdAt: 0 } as never);
    truth.set(PERSON, who, { household: who === stranger ? "home:1" : who } as never);
    truth.set(BODY_STATE, who, { consciousness: "alert", activity: "rest" } as never);
  }
  return truth;
}
function apply(truth: WorldTruth, result: ProcessResult) {
  for (const c of result.changes ?? []) if (c.op === "set") truth.setRaw(c.table, c.id, c.value);
}
function run(truth: WorldTruth, recent: readonly Event[]) {
  return debtKnowledgeProcess().run({
    truth,
    recent,
    now: 3000,
    scope: "world",
    rng: Rng.root(7),
  } as unknown as ProcessContext);
}
function event(
  id: number,
  kind: string,
  data: unknown,
  actors: readonly AgentId[] = [debtor, creditor],
): Event {
  return {
    id: `event:${id}` as EventId,
    tick: 1000 + id,
    kind,
    actors,
    data,
    place: { kind: "cell", cell: 0 },
    resolution: "local",
    emissions: {},
    causes: [],
  } as unknown as Event;
}

describe("fiado conocido", () => {
  it("scheduler aprende el acto en el mismo cierre perceive, paga por evidencia y conserva comportamiento apagado", () => {
    const execute = (on: boolean) => {
      const truth = fixture();
      const log = new EventLog();
      const actor: ProcessDef = {
        id: "test.credit_actor",
        system: "test",
        scope: "world",
        cadence: { local: "day" },
        phase: "act",
        representation: "individual",
        reads: [],
        writes: [],
        run(ctx) {
          const n = ctx.now / day;
          if (n > 3) return {};
          return {
            events: [
              {
                kind: n === 1 ? "household.borrowed" : n === 2 ? "action.give" : "household.repaid",
                actors: n === 1 ? [creditor, debtor] : [debtor, creditor],
                place: { kind: "cell", cell: 0 } as never,
                data:
                  n === 1
                    ? { credit: { unit: grain, grams: 200 } }
                    : n === 2
                      ? { effect: { kind: "give", to: creditor, good: grain, grams: 50 } }
                      : { payment: { unit: grain, grams: 150, credit: truth.ids(CREDIT)[0] } },
                emissions: {},
                causes: [{ kind: "state", entity: debtor, key: "intent" }],
              },
            ],
          };
        },
      };
      const scheduler = new Scheduler({
        rng: Rng.root(7),
        clock: EARTHLIKE_CLOCK,
        truth,
        ids: new IdAllocator(),
        log,
        resolution: "local",
        processes: [
          actor,
          creditProcess({ day, placeOf: () => ({ kind: "cell", cell: 0 }) as never }),
          ...(on ? [debtKnowledgeProcess()] : []),
        ],
      });
      scheduler.advanceTo(day);
      if (on) {
        expect(truth.get(DEBT_BOOK, debtor)?.items[0]).toMatchObject({
          kind: "credit",
          total: 200,
          remaining: 200,
          originEventId: log.all()[0]?.id,
        });
        expect(truth.get(DEBT_BOOK, debtor)?.items[0]?.dueDay).toBeUndefined();
        expect(truth.has(DEBT_BOOK, stranger)).toBe(false);
        expect(
          mediumGoals(
            debtGoalInputs(truth.get(DEBT_BOOK, debtor)),
            { memories: undefined, now: day, warmth: 0.5, control: 0.5, strengthIsWorth: 0 },
            [],
          )[0],
        ).toMatchObject({ weight: 0.6, target: creditor, originEventId: log.all()[0]?.id });
      }
      scheduler.advanceTo(2 * day);
      if (on) expect(truth.get(DEBT_BOOK, debtor)?.items[0]?.remaining).toBe(150);
      scheduler.advanceTo(3 * day);
      if (on) {
        expect(truth.get(DEBT_BOOK, debtor)?.items[0]?.status).toBe("fulfilled");
        expect(debtGoalInputs(truth.get(DEBT_BOOK, debtor))).toEqual([]);
      } else expect(truth.has(DEBT_BOOK, debtor)).toBe(false);
      return { rows: truth.rows().filter((r) => r.table !== DEBT_BOOK.name), events: log.all() };
    };
    expect(execute(true)).toEqual(execute(false));
  });

  it("monto anunciado y fuente propia; la verdad silenciosa, un tercero o préstamo secreto no completan el libro", () => {
    const truth = fixture();
    const id = "commitment:1";
    const source = event(1, "action.speak", { credit: { unit: grain, grams: 500 } }, [
      creditor,
      debtor,
    ]);
    truth.set(
      ENTITY,
      id as never,
      { id, originEventId: source.id, createdAt: source.tick } as never,
    );
    truth.set(CREDIT, id as never, lend(creditor, debtor, grain, 1000, source.tick, day));
    apply(truth, run(truth, [source]));
    expect(truth.get(DEBT_BOOK, debtor)?.items[0]?.total).toBe(500);
    expect(truth.get(DEBT_BOOK, debtor)?.items[0]?.remaining).toBe(500);
    expect(truth.has(DEBT_BOOK, stranger)).toBe(false);
    expect(run(truth, [source])).toEqual({});
    const real = truth.get(CREDIT, id as never);
    if (!real) throw new Error("missing fixture credit");
    truth.set(CREDIT, id as never, { ...real, owed: 0, status: "settled" });
    expect(run(truth, [])).toEqual({});
    expect(truth.get(DEBT_BOOK, debtor)?.items[0]?.remaining).toBe(500);
    expect(
      run(truth, [
        event(2, "action.give", { effect: { kind: "give", to: creditor, good: grain, grams: 0 } }),
      ]),
    ).toEqual({});
    expect(run(truth, [event(2, "action.give", { effect: { kind: "failed" } })])).toEqual({});
    expect(run(truth, [event(2, "action.give", null)])).toEqual({});
    expect(
      run(truth, [
        event(2, "action.give", {
          effect: { kind: "give", to: creditor, good: "good:silver", grams: 500 },
        }),
      ]),
    ).toEqual({});
    const partial = event(2, "household.repaid", {
      payment: { unit: grain, grams: 250, credit: id },
    });
    apply(truth, run(truth, [partial]));
    expect(truth.get(DEBT_BOOK, debtor)?.items[0]?.remaining).toBe(250);
    expect(run(truth, [partial])).toEqual({});
    truth.set(BODY_STATE, debtor, { consciousness: "unconscious", activity: "rest" } as never);
    apply(
      truth,
      run(truth, [
        event(3, "household.repaid", { payment: { unit: grain, grams: 250, credit: id } }),
      ]),
    );
    expect(truth.get(DEBT_BOOK, debtor)?.items[0]?.remaining).toBe(250);
    expect(truth.get(DEBT_BOOK, creditor)?.items[0]?.remaining).toBe(0);
    const secret = fixture();
    secret.set(CREDIT, id as never, lend(creditor, debtor, grain, 1000, source.tick, day));
    expect(run(secret, [])).toEqual({});
    expect(run(secret, [source])).toEqual({});
  });

  it("FIFO puro por acuerdos conocidos, no resta dos veces ni mezcla unidades, préstamos o destinatarios", () => {
    const first: DebtBelief = {
      commitment: "commitment:1",
      kind: "credit",
      openedAt: 1,
      role: "debtor",
      other: creditor,
      debtorRef: debtor,
      creditorRef: creditor,
      unit: grain,
      total: 100,
      remaining: 100,
      dueDay: 30,
      status: "active",
      originEventId: origin,
      learnedAt: 1000,
      confidence: 1,
      sources: [origin],
    };
    const second = { ...first, commitment: "commitment:2", openedAt: 2, total: 50, remaining: 50 };
    const hiddenLoan = {
      ...first,
      kind: "loan" as const,
      commitment: "commitment:3",
      remaining: 999,
    };
    const book = { items: [second, hiddenLoan, first] };
    const next = observeCreditPayment(
      book,
      debtor,
      debtor,
      creditor,
      grain,
      120,
      "event:4" as EventId,
      1200,
    );
    expect(next.items.map((b) => b.remaining)).toEqual([30, 999, 0]);
    expect(
      observeCreditPayment(next, debtor, debtor, creditor, grain, 120, "event:4" as EventId, 1200),
    ).toEqual(next);
    expect(
      observeCreditPayment(book, debtor, debtor, stranger, grain, 120, "event:4" as EventId, 1200),
    ).toEqual(book);
    expect(
      observeCreditPayment(
        book,
        debtor,
        debtor,
        creditor,
        "other",
        120,
        "event:4" as EventId,
        1200,
      ),
    ).toEqual(book);
    expect(
      observeCreditPayment(
        book,
        debtor,
        debtor,
        creditor,
        grain,
        120,
        "event:4" as EventId,
        1200,
        "commitment:2",
      ).items.map((b) => b.remaining),
    ).toEqual([0, 999, 100]);
  });
});
