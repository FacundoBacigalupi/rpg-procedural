import { describe, expect, it } from "vitest";
import type { Tick } from "../../core/index.ts";
import { holderAccount } from "../../core/index.ts";
import { PERSON, type ProcessContext, RELATIONS } from "../../sim/index.ts";
import { optInParts } from "./create.ts";
import { hireProcess } from "./hire.ts";
import { COMMITMENTS } from "./loans.ts";
import { NEIGHBOR_STANDING } from "./neighbors.ts";

function run(coins: number, who: string, bondage = true, heard?: "tight" | "broke") {
  const people: Record<string, unknown> = {
    "agent:a": { household: "h:a" },
    "agent:b": { household: "h:b" },
    "agent:c": { household: "h:b" },
  };
  const truth = {
    ids: (t: { name: string }) => (t.name === PERSON.name ? Object.keys(people) : []),
    get: (t: { name: string }, id: string) =>
      t.name === PERSON.name
        ? people[id]
        : t.name === RELATIONS.name
          ? { toward: { "agent:a": { dims: { trust: 1 } } } }
          : t.name === NEIGHBOR_STANDING.name && id === "agent:a" && heard
            ? { homes: { "h:b": { standing: heard, day: 0 } } }
            : undefined,
  } as never;
  const ledger = {
    balance: (a: unknown, u: string) =>
      a === holderAccount("agent:a" as never) && u === "coin" ? coins : 0,
  };
  const ctx = {
    truth,
    ledger,
    now: 10 as Tick,
    newId: () => "commitment:9",
    recent: [
      {
        id: "event:1",
        actors: ["agent:a"],
        data: { effect: { kind: "hire", who, what: "arado" } },
      },
    ],
  } as unknown as ProcessContext;
  return hireProcess({
    unit: "coin",
    placeOf: () => "here" as never,
    day: 1,
    baseWage: 10,
    crafts: new Set(),
    jobDays: 3,
    ...(heard ? { heedStanding: { broke: 0.2, tight: 0.6 } } : {}),
    ...(bondage ? { bondage: { wagePerDay: 10, upkeepPerDay: 2, maxDays: 30 } } : {}),
  }).run(ctx) as unknown as {
    events: { kind: string; data: { owed?: number } }[];
    postings?: { transfers: { amount: number; to: string }[] }[];
    changes?: { table?: string }[];
  };
}

describe("contratar a un oficial", () => {
  it("paga el jornal con asiento y deja el trabajo hecho", () => {
    const r = run(100, "agent:b");
    expect(r.events[0]?.kind).toBe("hire.done");
    expect(r.postings?.[0]?.transfers[0]?.amount).toBe(30);
    expect(r.events).toHaveLength(1);
  });
  it("ofrece menos al oficial que cree en la ruina (solo si lo cree)", () => {
    expect(run(100, "agent:b", true, "broke").postings?.[0]?.transfers[0]?.amount).toBe(6);
    expect(run(100, "agent:b", true, "tight").postings?.[0]?.transfers[0]?.amount).toBe(18);
    expect(run(100, "agent:b").postings?.[0]?.transfers[0]?.amount).toBe(30);
  });
  it("resuelve un hogar a una persona suya", () => {
    const r = run(100, "household:h:b");
    expect(r.postings?.[0]?.transfers[0]?.to).toBe(holderAccount("agent:b" as never));
  });
  it("sin plata abre servidumbre por jornal por lo que falta", () => {
    const r = run(10, "agent:b");
    expect(r.events.map((e) => e.kind)).toEqual(["hire.done", "hire.bonded"]);
    expect(r.events[0]?.data.owed).toBe(20);
    expect(COMMITMENTS.name).toBeDefined();
  });
  it("sin términos de servidumbre rechaza y no paga", () => {
    const r = run(10, "agent:b", false);
    expect(r.events[0]?.kind).toBe("hire.refused");
    expect(r.postings).toEqual([]);
  });
  it("apagado por defecto", () => {
    expect(optInParts({})).toEqual({});
  });
});
