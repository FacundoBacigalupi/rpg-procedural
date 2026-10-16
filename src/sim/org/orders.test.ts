import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type EventId,
  makeId,
  type OrgId,
  type SettlementId,
} from "../../core/index.ts";
import { foundCouncil, withdrawMember } from "./council.ts";
import type { OrgDecision } from "./issues.ts";
import {
  addOrder,
  assumeAmount,
  chooseExecutor,
  closeOrder,
  DEFAULT_ORDER_RULES,
  EMPTY_BOOK,
  obedienceChance,
  openOrders,
  orderFrom,
  orderViolations,
  spendable,
} from "./orders.ts";

const ag = (n: number) => makeId("agent", n);
const ev = (n: number) => makeId("event", n) as EventId;

const council = (n: number) =>
  foundCouncil({
    id: makeId("org", 1) as OrgId,
    settlement: makeId("settlement", 1) as SettlementId,
    elders: Array.from({ length: n }, (_, i) => ({
      agent: ag(i + 1) as AgentId,
      ageYears: 70 - i,
    })),
    originEventId: ev(1),
    at: 0,
  });

const decision = (raisedBy: AgentId, outcome: OrgDecision["outcome"]): OrgDecision => ({
  id: "decision:1",
  org: makeId("org", 1) as OrgId,
  issue: "issue:1",
  kind: "famine",
  subject: "household:1",
  option: "relief",
  raisedBy,
  outcome,
  votes: [],
  decidedAt: 10,
  raisedEvent: ev(2),
  causes: [{ kind: "event", event: ev(2) }],
});

describe("sim/org/orders", () => {
  it("solo una decisión aprobada es una orden, a cargo de quien la planteó", () => {
    const o = council(4);
    expect(orderFrom(o, decision(ag(2), "rejected"), "order:1", 10, ev(3))).toBeNull();
    expect(orderFrom(o, decision(ag(2), "lapsed"), "order:1", 10, ev(3))).toBeNull();
    const ord = orderFrom(o, decision(ag(2), "enacted"), "order:1", 10, ev(3));
    expect(ord).toMatchObject({ executor: ag(2), status: "pending", option: "relief" });
  });

  it("si quien la planteó ya no está, la cumple el cabeza; sin nadie, no hay orden", () => {
    let o = council(3);
    o = withdrawMember(o, ag(2), { at: 5, kind: "death", event: ev(9) });
    expect(chooseExecutor(o, decision(ag(2), "enacted"))).toBe(ag(1));
    for (const n of [1, 3]) o = withdrawMember(o, ag(n), { at: 6, kind: "death", event: ev(9) });
    expect(orderFrom(o, decision(ag(2), "enacted"), "order:1", 10, ev(3))).toBeNull();
  });

  it("la obediencia baja si votó en contra o si cumplir le toca el bolsillo", () => {
    const vote = (v: "for" | "against") => ({
      agent: ag(1),
      vote: v,
      weight: 1,
      utility: 0,
      confidence: 1,
    });
    const r = DEFAULT_ORDER_RULES;
    expect(obedienceChance(vote("for"), false, r)).toBe(r.assentObeys);
    expect(obedienceChance(vote("against"), false, r)).toBe(r.dissentObeys);
    expect(obedienceChance(vote("for"), true, r)).toBeLessThan(r.assentObeys);
    expect(obedienceChance(undefined, true, { ...r, dissentObeys: 0.2 })).toBe(0);
  });

  it("propiedad: gastar nunca pasa del saldo ni de lo pedido", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1e6, noNaN: true }),
        fc.double({ min: 0, max: 1e6, noNaN: true }),
        (want, bal) => {
          const s = spendable(want, bal);
          expect(Number.isInteger(s)).toBe(true);
          expect(s).toBeGreaterThanOrEqual(0);
          expect(s).toBeLessThanOrEqual(Math.floor(bal));
          expect(s).toBeLessThanOrEqual(Math.floor(want));
        },
      ),
    );
    expect(assumeAmount(101, DEFAULT_ORDER_RULES)).toBe(51);
  });

  it("propiedad: cualquier secuencia de altas y cierres cumple las reglas del libro", () => {
    const o = council(3);
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            exec: fc.integer({ min: 1, max: 3 }),
            status: fc.constantFrom("done", "refused", "failed", "void", "pending"),
            loan: fc.boolean(),
            spent: fc.integer({ min: 1, max: 500 }),
          }),
          { maxLength: 12 },
        ),
        (steps) => {
          let book = EMPTY_BOOK;
          steps.forEach((s, i) => {
            const d = decision(ag(s.exec), "enacted");
            const ord = orderFrom(o, d, `order:${i}`, i, ev(10 + i));
            if (!ord) return;
            book = addOrder(book, ord, 5);
            if (s.status !== "pending")
              book = closeOrder(book, ord.id, s.status, i + 1, {
                ...(s.status === "done" ? { spent: s.spent } : {}),
                ...(s.status === "done" && s.loan ? { loan: "commitment:1" } : {}),
              });
          });
          expect(orderViolations(o, book)).toEqual([]);
          expect(book.orders.length).toBeLessThanOrEqual(5);
          expect(openOrders(book).every((x) => x.status === "pending")).toBe(true);
        },
      ),
    );
  });

  it("un libro roto se detecta", () => {
    const o = council(2);
    const ord = orderFrom(o, decision(ag(1), "enacted"), "order:1", 1, ev(3));
    if (!ord) throw new Error("sin orden");
    const bad = { ...EMPTY_BOOK, orders: [ord, { ...ord, executor: ag(9) }] };
    expect(orderViolations(o, bad).length).toBeGreaterThanOrEqual(2);
  });
});
