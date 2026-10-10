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
  WorldTruth,
} from "../../sim/index.ts";
import { optInParts } from "./create.ts";
import {
  believedDebtRatio,
  DEBT_BOOK,
  type DebtBelief,
  debtGoalInputs,
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
  confidence: 1,
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
  it("conoce la deuda que asume el fiador sin duplicar el préstamo y sigue sus pagos anunciados", () => {
    const truth = fixture();
    const guarantor = "agent:4" as AgentId;
    truth.set(PERSON, guarantor, { household: "home:4" } as never);
    truth.set(ENTITY, guarantor, { originEventId: origin } as never);
    truth.set(BODY_STATE, guarantor, { consciousness: "alert", activity: "rest" } as never);
    apply(
      truth,
      run(truth, [
        event(1, "credit.loaned", { principal: 100, rate: 0, unit: "grain", dueDay: 10 }),
      ]),
    );
    const sub: Commitment = {
      ...commitment,
      id: "commitment:2",
      kind: "subrogation",
      parent: commitment.id,
      originEventId: "event:2",
      obligations: commitment.obligations.map((o) => ({
        ...o,
        creditor: "home:4",
        duty: { ...o.duty, qty: 60 },
      })),
    };
    truth.set(COMMITMENTS, sub.id as never, sub);
    const notice = {
      commitment: sub.id,
      debtor,
      creditor: guarantor,
      debtorRef: "home:1",
      creditorRef: "home:4",
      unit: "grain",
      qty: 60,
      dueDay: 10,
    };
    const defaulted = event(2, "credit.defaulted", {
      loss: 40,
      guarantorsPaid: [{ id: "home:4", amount: 60 }],
      subrogations: [notice],
    });
    apply(truth, run(truth, [defaulted]));
    const book = truth.get(DEBT_BOOK, debtor);
    expect(book?.items.map((b) => b.remaining)).toEqual([40, 60]);
    expect(book?.items.reduce((n, b) => n + b.remaining, 0)).toBe(100);
    expect(book?.items[1]).toMatchObject({
      other: guarantor,
      parent: commitment.id,
      originEventId: defaulted.id,
      confidence: 1,
    });
    expect(truth.get(DEBT_BOOK, guarantor)?.items[0]?.role).toBe("creditor");
    expect(truth.has(DEBT_BOOK, stranger)).toBe(false);
    const source = {
      memories: undefined,
      now: 2000,
      warmth: 0.5,
      control: 0.5,
      strengthIsWorth: 0,
    };
    expect(mediumGoals(debtGoalInputs(book), source, [])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target: guarantor, weight: 0.6, originEventId: defaulted.id }),
      ]),
    );
    expect(run(truth, [defaulted])).toEqual({});
    const paid = (id: number, amount: number, left: number) => ({
      ...event(id, "credit.subrogated_paid", {
        commitment: sub.id,
        parent: commitment.id,
        unit: "grain",
        paid: amount,
        left,
      }),
      actors: [debtor, guarantor],
    });
    const partial = paid(3, 30, 30);
    apply(truth, run(truth, [partial]));
    expect(
      debtGoalInputs(truth.get(DEBT_BOOK, debtor)).find((i) => i.who === guarantor)?.debt,
    ).toBe(0.5);
    expect(run(truth, [partial])).toEqual({});
    // La verdad se salda sin aviso: el libro sigue teniendo treinta hasta la noticia propia.
    truth.set(COMMITMENTS, sub.id as never, { ...sub, status: "fulfilled", obligations: [] });
    expect(run(truth, [])).toEqual({});
    expect(truth.get(DEBT_BOOK, debtor)?.items[1]?.remaining).toBe(30);
    truth.set(COMMITMENTS, sub.id as never, sub);
    // Un saldo explícitamente comunicado corrige lo viejo aunque no haya conocido cada pago.
    apply(truth, run(truth, [paid(4, 5, 10)]));
    expect(truth.get(DEBT_BOOK, debtor)?.items[1]?.remaining).toBe(10);
    expect(
      run(truth, [
        {
          ...paid(5, 10, 0),
          data: { commitment: sub.id, parent: commitment.id, unit: "silver", paid: 10, left: 0 },
        },
      ]),
    ).toEqual({});
    apply(truth, run(truth, [paid(5, 10, 0)]));
    expect(
      mediumGoals(debtGoalInputs(truth.get(DEBT_BOOK, debtor)), source, []).some(
        (g) => g.target === guarantor,
      ),
    ).toBe(false);
  });

  it("la subrogación invisible conserva saldo anterior; no revela derecho sin payload ni partes válidas", () => {
    const truth = fixture();
    const guarantor = "agent:4" as AgentId;
    truth.set(PERSON, guarantor, { household: "home:4" } as never);
    truth.set(ENTITY, guarantor, { originEventId: origin } as never);
    truth.set(BODY_STATE, guarantor, { consciousness: "alert", activity: "rest" } as never);
    apply(
      truth,
      run(truth, [
        event(1, "credit.loaned", { principal: 100, rate: 0, unit: "grain", dueDay: 10 }),
      ]),
    );
    const sub: Commitment = {
      ...commitment,
      id: "commitment:2",
      kind: "subrogation",
      parent: commitment.id,
      originEventId: "event:2",
      obligations: commitment.obligations.map((o) => ({
        ...o,
        creditor: "home:4",
        duty: { ...o.duty, qty: 100 },
      })),
    };
    truth.set(COMMITMENTS, sub.id as never, sub);
    truth.set(BODY_STATE, debtor, { consciousness: "unconscious", activity: "rest" } as never);
    const notice = {
      commitment: sub.id,
      debtor,
      creditor: guarantor,
      debtorRef: "home:1",
      creditorRef: "home:4",
      unit: "grain",
      qty: 100,
      dueDay: 10,
    };
    apply(truth, run(truth, [event(2, "credit.defaulted", { loss: 0, subrogations: [notice] })]));
    expect(truth.get(DEBT_BOOK, debtor)?.items.map((b) => b.remaining)).toEqual([100]);
    expect(truth.get(DEBT_BOOK, guarantor)?.items[0]?.remaining).toBe(100);
    const noNotice = fixture();
    noNotice.set(COMMITMENTS, sub.id as never, sub);
    apply(noNotice, run(noNotice, [event(2, "credit.defaulted", { loss: 0 })]));
    expect(noNotice.has(DEBT_BOOK, guarantor)).toBe(false);
    expect(noNotice.has(DEBT_BOOK, debtor)).toBe(false);
    apply(
      noNotice,
      run(noNotice, [
        event(2, "credit.defaulted", {
          loss: 0,
          subrogations: [{ ...notice, creditor: stranger }],
        }),
      ]),
    );
    expect(noNotice.has(DEBT_BOOK, stranger)).toBe(false);
  });
  it("proyecta fracciones con confianza y origen contractual sin memoria inventada ni suma de unidades", () => {
    const uncertain = { ...belief, confidence: 0.5 };
    const book = {
      items: [
        uncertain,
        { ...belief, commitment: "commitment:2", unit: "silver", remaining: 20, confidence: 1 },
      ],
    };
    expect(debtGoalInputs(book)).toEqual(debtGoalInputs({ items: [...book.items].reverse() }));
    expect(debtGoalInputs(book)).toEqual([
      {
        who: creditor,
        debt: 0.5,
        debtOriginEventId: origin,
        resentment: 0,
        closeness: 0,
        kin: false,
      },
    ]);
    const goals = mediumGoals(
      debtGoalInputs(book),
      { memories: undefined, now: 2000, warmth: 0.5, control: 0.5, strengthIsWorth: 0 },
      [],
    );
    expect(goals).toEqual([
      {
        id: `medium:debt:${creditor}`,
        layer: "medium",
        kind: "pursue",
        target: creditor,
        value: "justice",
        weight: 0.3,
        originEventId: origin,
        since: 2000,
      },
    ]);
    expect(debtGoalInputs({ items: [{ ...belief, confidence: 0 }] })).toEqual([]);
    expect(debtGoalInputs({ items: [{ ...belief, role: "creditor" }] })).toEqual([]);
    expect(debtGoalInputs(undefined)).toEqual([]);
    const update = observeDebt(
      { items: [uncertain] },
      {
        kind: "paid",
        commitment: commitment.id,
        amount: 50,
        event: "event:2" as EventId,
        at: 1200,
        fulfilled: false,
      },
    );
    expect(update.items[0]?.confidence).toBe(0.5);
    expect(debtGoalInputs(update)[0]?.debt).toBe(0.25);
  });

  it("sin ficha o cuerpo, dormido o inconsciente no registra conocimiento de la parte", () => {
    const open = event(1, "credit.loaned", { principal: 100, rate: 0, unit: "grain", dueDay: 10 });
    for (const absent of [ENTITY, BODY_STATE]) {
      const truth = fixture();
      truth.deleteRaw(absent.name, debtor);
      apply(truth, run(truth, [open]));
      expect(truth.has(DEBT_BOOK, debtor)).toBe(false);
      expect(truth.get(DEBT_BOOK, creditor)?.items[0]?.confidence).toBe(1);
    }
    const truth = fixture();
    truth.set(BODY_STATE, debtor, { consciousness: "alert", activity: "sleep" } as never);
    apply(truth, run(truth, [open]));
    expect(truth.has(DEBT_BOOK, debtor)).toBe(false);
  });
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
