import { describe, expect, it } from "vitest";
import type { CommitmentId, LedgerAccount } from "../../core/index.ts";
import { makeLoan, outstanding, payLoan } from "../economy/index.ts";
import { commitmentOwed, guarantorSubrogation, loanToCommitment } from "./commitment.ts";

const L = "acct:lender" as LedgerAccount;
const B = "acct:borrower" as LedgerAccount;

function loan() {
  const l = makeLoan({
    id: "commitment:1" as CommitmentId,
    lender: "agent:1",
    borrower: "agent:2",
    lenderAccount: L,
    borrowerAccount: B,
    unit: "grain" as never,
    requested: 100,
    rate: 0.2,
    startDay: 0,
    dueDay: 90,
    collateral: [{ ref: "parcel:1", believedValue: 200, trueValue: 150, heldBy: B }],
    guarantors: [{ id: "agent:3", account: "acct:g" as LedgerAccount, share: 0.5 }],
    unsecuredLimit: 0,
    originEventId: "event:1",
  });
  if (!l) throw new Error("loan");
  return l;
}

describe("loanToCommitment", () => {
  it("expresses the loan without changing its accounting", () => {
    const l = loan();
    const c = loanToCommitment(l, { enforcement: { community: "village", karma: true } });
    expect(c.kind).toBe("loan");
    expect(c.basis).toBe("agreement");
    expect(commitmentOwed(c)).toBe(outstanding(l));
    expect(c.guarantees.map((g) => g.kind)).toEqual(["collateral", "guarantor"]);
    expect(c.enforcers.map((e) => e.kind)).toEqual([
      "conscience",
      "counterparty",
      "social",
      "guarantee",
      "karmic",
    ]);
    expect(c.enforcers.find((e) => e.kind === "karmic")?.reads).toBe("truth");
  });

  it("tracks partial payments and settlement", () => {
    const l = loan();
    const p = payLoan(l, 50, 1000).loan;
    const c = loanToCommitment(p);
    expect(commitmentOwed(c)).toBe(outstanding(p));
    expect(c.obligations[0]?.state).toBe("partial");
    const done = loanToCommitment(payLoan(p, 1000, 1000).loan);
    expect(done.status).toBe("fulfilled");
    expect(commitmentOwed(done)).toBe(0);
  });

  it("subrogates a paying guarantor as creditor with the loan as parent", () => {
    const c = loanToCommitment(loan());
    const s = guarantorSubrogation(c, "agent:3", 30, "commitment:2", "event:2", 91);
    expect(s?.parent).toBe(c.id);
    expect(s?.parties[0]).toEqual({ ref: "agent:3", role: "creditor" });
    expect(s?.enforcers.some((e) => e.kind === "guarantee")).toBe(false);
    expect(guarantorSubrogation(c, "agent:3", 0, "x", "e", 1)).toBeUndefined();
  });
});
