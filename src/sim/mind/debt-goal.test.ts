import { describe, expect, it } from "vitest";
import { makeId, type Tick } from "../../core/index.ts";
import {
  debtGoalCompletionFromEvidence,
  debtGoalSnapshot,
  type KnownDebtEvidence,
} from "./debt-goal.ts";

const creditor = makeId("agent", 2);
const at = (value: number) => value as Tick;
const evidence = (
  commitment: number,
  overrides: Partial<KnownDebtEvidence> = {},
): KnownDebtEvidence => ({
  commitment: makeId("commitment", commitment),
  role: "debtor",
  other: creditor,
  remaining: 20,
  status: "active",
  originEventId: makeId("event", commitment),
  learnedAt: at(10),
  confidence: 1,
  sources: [makeId("event", commitment)],
  paidSources: [],
  ...overrides,
});

describe("sim.mind.debt-goal", () => {
  it("congela solo compromisos conocidos como deudor, positivos y anteriores al nacimiento", () => {
    const input = [
      evidence(2),
      evidence(1),
      evidence(3, { role: "creditor" }),
      evidence(4, { remaining: 0, status: "fulfilled" }),
      evidence(5, { learnedAt: at(30) }),
    ];
    expect(debtGoalSnapshot(input, creditor, at(20))).toEqual({
      other: creditor,
      bornAt: at(20),
      entries: [
        {
          commitment: makeId("commitment", 1),
          origin: makeId("event", 1),
          sources: [makeId("event", 1)],
          paidSources: [],
        },
        {
          commitment: makeId("commitment", 2),
          origin: makeId("event", 2),
          sources: [makeId("event", 2)],
          paidSources: [],
        },
      ],
    });
    expect(debtGoalSnapshot([], creditor, at(20))).toBeUndefined();
  });

  it("cierra solo al liquidarse cada compromiso del snapshot con fuentes nuevas", () => {
    const first = evidence(1);
    const second = evidence(2);
    const snapshot = debtGoalSnapshot([first, second], creditor, at(20));
    expect(snapshot).toBeDefined();
    if (snapshot === undefined) throw new Error("snapshot should include the open debts");
    const paid = [
      {
        ...first,
        remaining: 0,
        status: "fulfilled" as const,
        learnedAt: at(21),
        sources: [...first.sources, makeId("event", 11)],
        paidSources: [makeId("event", 11)],
      },
      {
        ...second,
        remaining: 0,
        status: "settled" as const,
        learnedAt: at(22),
        sources: [...second.sources, makeId("event", 12)],
        paidSources: [makeId("event", 12)],
      },
      evidence(3),
    ];
    expect(debtGoalCompletionFromEvidence(snapshot, paid, at(23))).toEqual({
      at: at(23),
      evidence: [
        { commitment: makeId("commitment", 1), cause: makeId("event", 11) },
        { commitment: makeId("commitment", 2), cause: makeId("event", 12) },
      ],
    });
    expect(debtGoalCompletionFromEvidence(snapshot, paid.slice(0, 1), at(23))).toBeUndefined();
  });

  it("ignora saldo truth-like ausente, cierre sin fuente nueva, estado impago y evidencia futura", () => {
    const open = evidence(1);
    const snapshot = debtGoalSnapshot([open], creditor, at(20));
    expect(snapshot).toBeDefined();
    if (snapshot === undefined) throw new Error("snapshot should include the open debt");
    const closed = { ...open, remaining: 0, status: "fulfilled" as const };
    expect(debtGoalCompletionFromEvidence(snapshot, [], at(30))).toBeUndefined();
    expect(debtGoalCompletionFromEvidence(snapshot, [closed], at(30))).toBeUndefined();
    expect(
      debtGoalCompletionFromEvidence(
        snapshot,
        [{ ...closed, status: "settled", sources: [...closed.sources, makeId("event", 8)] }],
        at(30),
      ),
    ).toBeUndefined();
    expect(
      debtGoalCompletionFromEvidence(
        snapshot,
        [
          {
            ...closed,
            status: "defaulted",
            sources: [...closed.sources, makeId("event", 9)],
            paidSources: [makeId("event", 9)],
          },
        ],
        at(30),
      ),
    ).toBeUndefined();
    expect(
      debtGoalCompletionFromEvidence(
        snapshot,
        [
          {
            ...closed,
            status: "settled",
            learnedAt: at(31),
            sources: [...closed.sources, makeId("event", 9)],
            paidSources: [makeId("event", 9)],
          },
        ],
        at(30),
      ),
    ).toBeUndefined();
  });

  it("ordena el snapshot y las causas de forma determinista", () => {
    const a = evidence(1, { sources: [makeId("event", 9), makeId("event", 8)] });
    const b = evidence(2);
    const one = debtGoalSnapshot([a, b], creditor, at(20));
    const two = debtGoalSnapshot([b, a], creditor, at(20));
    expect(one).toEqual(two);
    expect(one?.entries[0]?.sources).toEqual([makeId("event", 8), makeId("event", 9)]);
  });

  it("no convierte una fuente de apertura o ya conocida en prueba nueva de pago", () => {
    const oldNotice = makeId("event", 8);
    const open = evidence(1, { sources: [makeId("event", 1), oldNotice] });
    const snapshot = debtGoalSnapshot([open], creditor, at(20));
    if (!snapshot) throw new Error("missing snapshot");
    for (const source of [open.originEventId, oldNotice, makeId("event", 99)]) {
      const closed = {
        ...open,
        remaining: 0,
        status: "settled" as const,
        learnedAt: at(21),
        paidSources: [source],
      };
      expect(debtGoalCompletionFromEvidence(snapshot, [closed], at(22))).toBeUndefined();
    }
  });

  it("rechaza libros ambiguos en cualquier orden sin modificar el libro ni el snapshot", () => {
    const open = evidence(1);
    const snapshot = debtGoalSnapshot([open], creditor, at(20));
    if (!snapshot) throw new Error("missing snapshot");
    const paid = {
      ...open,
      remaining: 0,
      status: "fulfilled" as const,
      learnedAt: at(21),
      sources: [...open.sources, makeId("event", 8)],
      paidSources: [makeId("event", 8)],
    };
    for (const book of [
      [open, paid],
      [paid, open],
    ]) {
      const before = structuredClone(book);
      expect(debtGoalSnapshot(book, creditor, at(22))).toBeUndefined();
      expect(debtGoalCompletionFromEvidence(snapshot, book, at(22))).toBeUndefined();
      expect(book).toEqual(before);
    }
    expect(debtGoalSnapshot([evidence(2, { confidence: 2 })], creditor, at(20))).toBeUndefined();
  });

  it("conserva un snapshot finito aunque nazcan deudas nuevas y elige causas canónicas", () => {
    const open = evidence(1);
    const snapshot = debtGoalSnapshot([open], creditor, at(20));
    if (!snapshot) throw new Error("missing snapshot");
    const before = structuredClone(snapshot);
    const causes = [makeId("event", 9), makeId("event", 8)];
    const paid = {
      ...open,
      remaining: 0,
      status: "fulfilled" as const,
      learnedAt: at(21),
      sources: [...open.sources, ...causes],
      paidSources: causes,
    };
    const one = debtGoalCompletionFromEvidence(snapshot, [paid, evidence(2)], at(22));
    const two = debtGoalCompletionFromEvidence(
      snapshot,
      [evidence(2), { ...paid, paidSources: [...causes].reverse() }],
      at(22),
    );
    expect(one).toEqual({
      at: at(22),
      evidence: [{ commitment: open.commitment, cause: makeId("event", 8) }],
    });
    expect(two).toEqual(one);
    expect(snapshot).toEqual(before);
  });
});
