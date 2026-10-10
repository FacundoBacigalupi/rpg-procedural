import { describe, expect, it } from "vitest";
import {
  bondageDebtLeft,
  bondageExpired,
  endBondage,
  makeBondage,
  workBondageDay,
} from "./bondage.ts";

const base = {
  id: "commitment:9",
  creditor: "agent:1",
  debtor: "agent:2",
  debt: 20,
  wagePerDay: 3,
  upkeepPerDay: 1,
  startDay: 10,
  maxDays: 30,
  originEventId: "event:1",
};

describe("bondage", () => {
  it("pays down by net credit per worked day and ends fulfilled", () => {
    let c = makeBondage(base);
    if (!c) throw new Error("bondage");
    expect(bondageDebtLeft(c)).toBe(20);
    let total = 0;
    for (let d = 10; d < 20; d++) {
      const r = workBondageDay(c, d);
      c = r.commitment;
      total += r.credited;
    }
    expect(total).toBe(20);
    expect(c.status).toBe("fulfilled");
  });

  it("never pays when upkeep eats the wage, and expires at term", () => {
    const c = makeBondage({ ...base, upkeepPerDay: 3 });
    if (!c) throw new Error("bondage");
    expect(c.obligations[0]?.duty.qty).toBe(30);
    expect(workBondageDay(c, 10).credited).toBe(0);
    expect(bondageExpired(c, 40)).toBe(true);
    const e = endBondage(c, "term", "event:2");
    expect(e.commitment.status).toBe("settled");
    expect(e.unpaid).toBe(0);
  });

  it("escape defaults and keeps the unpaid debt", () => {
    const c = makeBondage(base);
    if (!c) throw new Error("bondage");
    const e = endBondage(workBondageDay(c, 10).commitment, "escape", "event:3");
    expect(e.commitment.status).toBe("defaulted");
    expect(e.unpaid).toBe(18);
  });
});
