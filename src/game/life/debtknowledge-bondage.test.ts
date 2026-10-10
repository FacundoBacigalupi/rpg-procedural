import { describe, expect, it } from "vitest";
import { type AgentId, type Event, type EventId, Rng } from "../../core/index.ts";
import {
  BODY_STATE,
  type Commitment,
  ENTITY,
  mediumGoals,
  PERSON,
  type ProcessContext,
  type ProcessResult,
  WORK_DAY_UNIT,
  WorldTruth,
} from "../../sim/index.ts";
import {
  DEBT_BOOK,
  type DebtBelief,
  debtGoalInputs,
  debtKnowledgeProcess,
} from "./debtknowledge.ts";
import { COMMITMENTS } from "./loans.ts";

const debtor = "agent:1" as AgentId;
const creditor = "agent:2" as AgentId;
const stranger = "agent:3" as AgentId;
const loan = "commitment:1";
const bond = "commitment:2";
const cause = "event:2" as EventId;
const belief: DebtBelief = {
  commitment: loan,
  kind: "loan",
  role: "debtor",
  other: creditor,
  debtorRef: "home:1",
  creditorRef: "home:2",
  unit: "grain",
  total: 100,
  remaining: 100,
  status: "defaulted",
  originEventId: "event:1" as EventId,
  learnedAt: 1000,
  confidence: 1,
  sources: ["event:1" as EventId],
};
const contract: Commitment = {
  id: bond,
  kind: "bondage",
  basis: "norm",
  parties: [
    { ref: "home:1", role: "bonded" },
    { ref: "home:2", role: "master" },
  ],
  obligations: [
    {
      id: `${bond}#work`,
      debtor: "home:1",
      creditor: "home:2",
      duty: { kind: "work", unit: WORK_DAY_UNIT, qty: 999, creditPerDay: 999 },
      dueDay: 999,
      state: "partial",
      performed: 998,
    },
  ],
  guarantees: [],
  enforcers: [],
  status: "active",
  parent: loan,
  term: { startDay: 0, endDay: 999 },
  originEventId: cause,
  history: [],
};
function fixture() {
  const truth = new WorldTruth();
  for (const [who, home] of [
    [debtor, "home:1"],
    [creditor, "home:2"],
    [stranger, "home:1"],
  ] as const) {
    truth.set(ENTITY, who, { originEventId: "event:1" } as never);
    truth.set(PERSON, who, { household: home } as never);
    truth.set(BODY_STATE, who, { consciousness: "alert", activity: "rest" } as never);
  }
  truth.set(COMMITMENTS, bond as never, contract);
  truth.set(DEBT_BOOK, debtor, { items: [belief] });
  truth.set(DEBT_BOOK, creditor, { items: [{ ...belief, role: "creditor", other: debtor }] });
  return truth;
}
function event(id: number, kind: string, data: Record<string, unknown>): Event {
  return {
    id: `event:${id}` as EventId,
    tick: 1000 + id,
    kind,
    actors: [debtor, creditor],
    data: { commitment: bond, ...data },
    place: { kind: "cell", cell: 0 },
    resolution: "local",
    emissions: {},
    causes: [],
  } as unknown as Event;
}
const opened = () =>
  event(2, "credit.bonded", {
    loan,
    debt: 100,
    maxDays: 20,
    unit: WORK_DAY_UNIT,
    workDays: 10,
    creditPerDay: 10,
    debtUnit: "grain",
  });
const work = (id: number, credited: number, paid: boolean) =>
  event(id, "credit.bondage_worked", { parent: loan, credited, paid });
function run(truth: WorldTruth, recent: readonly Event[]) {
  return debtKnowledgeProcess().run({
    truth,
    recent,
    now: 2000,
    scope: "world",
    rng: Rng.root(7),
  } as unknown as ProcessContext);
}
function apply(truth: WorldTruth, out: ProcessResult) {
  for (const c of out.changes ?? []) if (c.op === "set") truth.setRaw(c.table, c.id, c.value);
}
const goals = (truth: WorldTruth) =>
  mediumGoals(
    debtGoalInputs(truth.get(DEBT_BOOK, debtor)),
    { memories: undefined, now: 2000, warmth: 0.5, control: 0.5, strengthIsWorth: 0 },
    [],
  );

describe("servidumbre conocida", () => {
  it("guarda trabajo pactado, sustituye préstamo conocido y descuenta días sin leer cantidad/performed real", () => {
    const truth = fixture();
    apply(truth, run(truth, [opened()]));
    const book = truth.get(DEBT_BOOK, debtor);
    expect(book?.items[0]).toMatchObject({ remaining: 0, status: "settled" });
    expect(book?.items[1]).toMatchObject({
      kind: "bondage",
      parent: loan,
      unit: WORK_DAY_UNIT,
      total: 10,
      remaining: 10,
      originEventId: cause,
      work: { creditPerDay: 10, debtUnit: "grain", debt: 100, maxDays: 20 },
    });
    expect(book?.items[1]?.dueDay).toBeUndefined();
    expect(goals(truth)).toHaveLength(1);
    expect(goals(truth)[0]).toMatchObject({ target: creditor, weight: 0.6, originEventId: cause });
    expect(truth.has(DEBT_BOOK, stranger)).toBe(false);
    expect(run(truth, [opened()])).toEqual({});
    const partial = work(3, 20, false);
    apply(truth, run(truth, [partial]));
    expect(truth.get(DEBT_BOOK, debtor)?.items[1]?.remaining).toBe(8);
    expect(goals(truth)[0]?.weight).toBe(0.48);
    expect(run(truth, [partial])).toEqual({});
    truth.set(COMMITMENTS, bond as never, { ...contract, status: "fulfilled" });
    expect(run(truth, [])).toEqual({});
    expect(goals(truth)[0]?.weight).toBe(0.48);
    apply(truth, run(truth, [work(4, 80, true)]));
    expect(goals(truth)).toEqual([]);
  });

  it("al conocerse término/rescate/abuso se libera; fuga conserva deuda de trabajo anunciada", () => {
    for (const end of ["term", "ransom", "abuse", "escape"] as const) {
      const truth = fixture();
      apply(truth, run(truth, [opened()]));
      const closure = event(3, "credit.bondage_ended", { parent: loan, end, unpaid: 50 });
      apply(truth, run(truth, [closure]));
      expect(truth.get(DEBT_BOOK, debtor)?.items[1]).toMatchObject({
        status: end === "escape" ? "defaulted" : "settled",
        remaining: end === "escape" ? 5 : 0,
      });
      expect(goals(truth).length).toBe(end === "escape" ? 1 : 0);
      expect(run(truth, [closure])).toEqual({});
    }
    const zero = fixture();
    const start = opened();
    apply(zero, run(zero, [{ ...start, data: { ...(start.data as object), creditPerDay: 0 } }]));
    apply(
      zero,
      run(zero, [event(3, "credit.bondage_ended", { parent: loan, end: "escape", unpaid: 0 })]),
    );
    expect(truthRemaining(zero)).toBe(10);
  });

  it("inconsciente o sin persona/cuerpo no aprende ni sustituye; historial sin términos queda desconocido", () => {
    for (const absent of [PERSON, BODY_STATE, ENTITY]) {
      const truth = fixture();
      truth.deleteRaw(absent.name, debtor);
      apply(truth, run(truth, [opened()]));
      expect(truth.get(DEBT_BOOK, debtor)?.items).toEqual([belief]);
      expect(truth.get(DEBT_BOOK, creditor)?.items[1]?.kind).toBe(
        absent.name === PERSON.name ? undefined : "bondage",
      );
    }
    const unconscious = fixture();
    unconscious.set(BODY_STATE, debtor, {
      consciousness: "unconscious",
      activity: "rest",
    } as never);
    apply(unconscious, run(unconscious, [opened()]));
    expect(unconscious.get(DEBT_BOOK, debtor)?.items).toEqual([belief]);
    const historic = fixture();
    expect(run(historic, [event(2, "credit.bonded", { loan, debt: 100, maxDays: 20 })])).toEqual(
      {},
    );
    expect(run(historic, [work(3, 20, false)])).toEqual({});
    expect(
      run(historic, [event(3, "credit.bondage_ended", { parent: loan, end: "term", unpaid: 100 })]),
    ).toEqual({});
  });
});
function truthRemaining(truth: WorldTruth) {
  return truth.get(DEBT_BOOK, debtor)?.items[1]?.remaining;
}
