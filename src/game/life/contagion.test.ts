import { describe, expect, it } from "vitest";
import type { AgentId, Tick } from "../../core/index.ts";
import { holderAccount, ledgerUnit } from "../../core/index.ts";
import { type Commitment, PERSON, type ProcessContext } from "../../sim/index.ts";
import { CONTAGION_EVENT, contagionProcess } from "./contagion.ts";
import { optInParts } from "./create.ts";
import { offenseOf } from "./deeds.ts";
import { COMMITMENTS } from "./loans.ts";

const loan = (id: string, debtor: string, creditor: string, qty: number): Commitment =>
  ({
    id,
    status: "active",
    obligations: [
      {
        debtor,
        creditor,
        duty: { kind: "deliver", unit: "coin", qty },
        performed: 0,
        state: "pending",
      },
    ],
  }) as unknown as Commitment;

describe("contagio de quiebras en la vida", () => {
  it("emite quiebra por quiebra con causas y no mueve bienes", () => {
    const rows: Record<string, Commitment> = {
      "commitment:1": loan("commitment:1", "h:b", "h:a", 100),
      "commitment:2": loan("commitment:2", "h:c", "h:b", 100),
    };
    const people: Record<string, unknown> = {};
    for (const h of ["a", "b", "c"]) people[`agent:${h}`] = { household: `h:${h}` };
    const bal: Record<string, number> = { "h:c": 0, "h:b": 0, "h:a": 50 };
    const truth = {
      ids: (t: { name: string }) =>
        t.name === COMMITMENTS.name
          ? Object.keys(rows)
          : t.name === PERSON.name
            ? Object.keys(people)
            : [],
      get: (t: { name: string }, id: string) =>
        t.name === COMMITMENTS.name ? rows[id] : t.name === PERSON.name ? people[id] : undefined,
    } as never;
    const ledger = {
      balance: (a: unknown) => {
        for (const h of Object.keys(bal)) if (a === holderAccount(h as never)) return bal[h];
        return 0;
      },
    };
    void ledgerUnit;
    const ctx = { truth, ledger, now: 1 as Tick } as unknown as ProcessContext;
    const r = contagionProcess({ unit: "coin", placeOf: () => "here" as never }).run(
      ctx,
    ) as unknown as {
      events: {
        kind: string;
        causes: { kind: string }[];
        data: { household: string; round: number };
      }[];
      postings?: unknown;
    };
    expect(r.postings).toBeUndefined();
    expect(r.events.every((e) => e.kind === CONTAGION_EVENT && e.causes.length > 0)).toBe(true);
    expect(r.events.map((e) => e.data.household)).toEqual(["h:c", "h:b"]);
    expect(r.events[1]?.causes[0]?.kind).toBe("event");
    void ({} as AgentId);
  });
  it("apagado por defecto", () => {
    expect(optInParts({})).toEqual({});
    expect(optInParts({ loanContagion: "coin:copper" })).toEqual({ loanContagion: "coin:copper" });
  });
  it("con fama anota los acreedores del quebrado y offenseOf los lee", () => {
    const rows: Record<string, Commitment> = {
      "commitment:1": loan("commitment:1", "h:b", "h:a", 100),
    };
    const people: Record<string, unknown> = {
      "agent:a": { household: "h:a" },
      "agent:b": { household: "h:b" },
    };
    const truth = {
      ids: (t: { name: string }) =>
        t.name === COMMITMENTS.name
          ? Object.keys(rows)
          : t.name === PERSON.name
            ? Object.keys(people)
            : [],
      get: (t: { name: string }, id: string) =>
        t.name === COMMITMENTS.name ? rows[id] : t.name === PERSON.name ? people[id] : undefined,
    } as never;
    const ledger = { balance: () => 0 };
    const ctx = { truth, ledger, now: 1 as Tick } as unknown as ProcessContext;
    const r = contagionProcess({ unit: "coin", placeOf: () => "here" as never, fame: true }).run(
      ctx,
    ) as unknown as {
      events: { actors: string[]; data: { creditors?: string[] } }[];
    };
    expect(r.events[0]?.data.creditors).toEqual(["agent:a"]);
    const off = offenseOf({
      kind: CONTAGION_EVENT,
      actors: r.events[0]?.actors,
      data: r.events[0]?.data,
    } as never);
    expect(off?.kind).toBe("default");
    expect(off?.by).toBe("agent:b");
    expect(off?.noticedBy).toEqual(["agent:a"]);
  });
});
