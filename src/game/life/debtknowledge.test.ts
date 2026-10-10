import { describe, expect, it } from "vitest";
import { type AgentId, type Event, type EventId, Rng } from "../../core/index.ts";
import {
  BODY_STATE,
  type Commitment,
  ENTITY,
  PERSON,
  type ProcessContext,
  type ProcessResult,
  WorldTruth,
} from "../../sim/index.ts";
import { optInParts } from "./create.ts";
import {
  believedDebtRatio,
  DEBT_BOOK,
  type DebtBelief,
  debtKnowledgeProcess,
  observeDebt,
} from "./debtknowledge.ts";
import { COMMITMENTS } from "./loans.ts";

const debtor = "agent:1" as AgentId;
const creditor = "agent:2" as AgentId;
const stranger = "agent:3" as AgentId;
const origin = "event:1" as EventId;
const commitment: Commitment = {
  id: "commitment:1",
  kind: "loan",
  basis: "agreement",
  parties: [
    { ref: "home:1", role: "borrower" },
    { ref: "home:2", role: "lender" },
  ],
  obligations: [
    {
      id: "commitment:1#repay",
      debtor: "home:1",
      creditor: "home:2",
      duty: { kind: "deliver", unit: "grain", qty: 150 },
      dueDay: 10,
      state: "pending",
      performed: 0,
    },
  ],
  guarantees: [],
  enforcers: [],
  status: "active",
  term: { startDay: 0, endDay: 10 },
  originEventId: origin,
  history: [],
};
const belief: DebtBelief = {
  commitment: commitment.id,
  role: "debtor",
  other: creditor,
  debtorRef: "home:1",
  creditorRef: "home:2",
  unit: "grain",
  total: 100,
  remaining: 100,
  dueDay: 10,
  status: "active",
  originEventId: origin,
  learnedAt: 1000,
  sources: [origin],
};
function event(id: number, kind: string, data: Record<string, unknown>): Event {
  return {
    id: `event:${id}` as EventId,
    tick: 1000 + id,
    kind,
    actors: kind === "credit.loaned" ? [creditor, debtor] : [debtor, creditor],
    data: { loan: commitment.id, ...data },
    place: { kind: "none" },
    resolution: "local",
    emissions: {},
    causes: [{ kind: "event", event: origin }],
  } as unknown as Event;
}
function fixture() {
  const truth = new WorldTruth();
  for (const [who, home] of [
    [debtor, "home:1"],
    [creditor, "home:2"],
    [stranger, "home:1"],
  ] as const) {
    truth.set(PERSON, who, { household: home } as never);
    truth.set(ENTITY, who, { originEventId: origin } as never);
    truth.set(BODY_STATE, who, { consciousness: "awake", activity: "rest" } as never);
  }
  truth.set(COMMITMENTS, commitment.id as never, commitment);
  return truth;
}
function run(truth: WorldTruth, recent: readonly Event[]) {
  return debtKnowledgeProcess().run({
    truth,
    recent,
    now: 2000,
    scope: "world",
    rng: Rng.root(7),
  } as unknown as ProcessContext);
}
function apply(truth: WorldTruth, result: ProcessResult) {
  for (const c of result.changes ?? []) if (c.op === "set") truth.setRaw(c.table, c.id, c.value);
}

describe("libro de deuda conocida", () => {
  it("normaliza por contrato y actualiza solo evidencia nueva; un pago desconocido no inventa deuda", () => {
    const opened = observeDebt(undefined, { kind: "opened", belief });
    expect(believedDebtRatio(belief)).toBe(1);
    const paid = {
      kind: "paid",
      commitment: commitment.id,
      amount: 25,
      event: "event:2" as EventId,
      at: 1100,
      fulfilled: false,
    } as const;
    const next = observeDebt(opened, paid);
    expect(next.items[0]?.remaining).toBe(75);
    expect(believedDebtRatio(next.items[0] as DebtBelief)).toBe(0.75);
    expect(next.items[0]?.originEventId).toBe(origin);
    expect(observeDebt(next, paid)).toEqual(next);
    expect(observeDebt(undefined, paid).items).toEqual([]);
    const fulfilled = observeDebt(next, {
      ...paid,
      event: "event:3" as EventId,
      at: 1200,
      amount: 5,
      fulfilled: true,
    });
    expect(fulfilled.items[0]?.status).toBe("fulfilled");
    expect(believedDebtRatio(fulfilled.items[0] as DebtBelief)).toBe(0);
    expect(believedDebtRatio({ ...belief, role: "creditor" })).toBe(0);
  });

  it("las partes conocen los términos anunciados, sin filtrar tasa oculta ni deuda a otros hogares", () => {
    const truth = fixture();
    apply(
      truth,
      run(truth, [
        event(1, "credit.loaned", {
          principal: 100,
          rate: 0.5,
          statedRate: 0,
          disguise: "service",
          unit: "grain",
          dueDay: 10,
        }),
      ]),
    );
    expect(truth.get(DEBT_BOOK, debtor)?.items[0]).toMatchObject({
      total: 100,
      remaining: 100,
      role: "debtor",
      originEventId: origin,
    });
    expect(truth.get(DEBT_BOOK, creditor)?.items[0]?.role).toBe("creditor");
    expect(truth.has(DEBT_BOOK, stranger)).toBe(false);
    expect(
      run(truth, [
        event(1, "credit.loaned", {
          principal: 100,
          rate: 0.5,
          statedRate: 0,
          disguise: "service",
          unit: "grain",
          dueDay: 10,
        }),
      ]),
    ).toEqual({});
  });

  it("mantiene creencia si cambia la verdad; pago propio conocido la reduce y cumplimiento la libera", () => {
    const truth = fixture();
    const opened = event(1, "credit.loaned", {
      principal: 100,
      rate: 0,
      unit: "grain",
      dueDay: 10,
    });
    apply(truth, run(truth, [opened]));
    truth.set(COMMITMENTS, commitment.id as never, {
      ...commitment,
      status: "fulfilled",
      obligations: commitment.obligations.map((o) => ({ ...o, performed: 150 })),
    });
    expect(run(truth, [])).toEqual({});
    expect(truth.get(DEBT_BOOK, debtor)?.items[0]?.remaining).toBe(100);
    const paid = event(2, "credit.paid", { paid: 25, status: "active" });
    apply(truth, run(truth, [paid]));
    expect(truth.get(DEBT_BOOK, debtor)?.items[0]?.remaining).toBe(75);
    expect(run(truth, [paid])).toEqual({});
    truth.set(BODY_STATE, debtor, { consciousness: "unconscious", activity: "rest" } as never);
    const done = event(3, "credit.paid", { paid: 75, status: "repaid" });
    apply(truth, run(truth, [done]));
    expect(truth.get(DEBT_BOOK, debtor)?.items[0]?.remaining).toBe(75);
    expect(truth.get(DEBT_BOOK, creditor)?.items[0]?.status).toBe("fulfilled");
  });

  it("ignorancia de un contrato secreto, origen invalidado y partes ajenas no crean libro", () => {
    const truth = fixture();
    expect(run(truth, [])).toEqual({});
    expect(run(truth, [event(2, "credit.paid", { paid: 25, status: "active" })])).toEqual({});
    expect(
      run(truth, [
        event(4, "credit.loaned", { principal: 100, rate: 0, unit: "grain", dueDay: 10 }),
      ]),
    ).toEqual({});
    const fake = event(1, "credit.loaned", { principal: 100, rate: 0, unit: "grain", dueDay: 10 });
    expect(run(truth, [{ ...fake, actors: [creditor, "agent:4" as AgentId] }])).toEqual({});
    expect(truth.has(DEBT_BOOK, debtor)).toBe(false);
  });

  it("cadencia y único escritor declarados; opción apagada no agrega configuración", () => {
    const p = debtKnowledgeProcess();
    expect(p.phase).toBe("perceive");
    expect(p.cadence.local).toBe("onEvent");
    expect(p.writes).toEqual([DEBT_BOOK.name]);
    expect(optInParts({ debtKnowledge: false })).toEqual(optInParts({}));
    expect(optInParts({ debtKnowledge: true })).toEqual({ debtKnowledge: true });
  });
});
