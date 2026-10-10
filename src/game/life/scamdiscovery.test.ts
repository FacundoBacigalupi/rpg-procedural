import { describe, expect, it } from "vitest";
import { type AgentId, type EventId, ledgerUnit, type Tick } from "../../core/index.ts";
import {
  ENTITY,
  PERSON,
  type ProcessContext,
  type ReadonlyWorldTruth,
  SCAM_DEALS,
  SCAM_FOUND,
} from "../../sim/index.ts";
import {
  APPRAISAL_FEE,
  APPRAISAL_HAZARD,
  SCAM_APPRAISED,
  scamDiscoveryProcess,
} from "./scamdiscovery.ts";

const buyer = "agent:1" as AgentId;
const seller = "agent:2" as AgentId;
const expert = "agent:3" as AgentId;
const coin = ledgerUnit("coin");

function run(opts: { eyes: Record<string, number>; day: number; refund?: number }) {
  const deal = {
    event: "event:7" as EventId,
    tick: 0 as Tick,
    seller,
    unit: "good:grain",
    grams: 8000,
    coins: 5,
    real: 0.2,
    believed: 0.8,
    trust: 0.5,
  };
  const tables: Record<string, Record<string, unknown>> = {
    [SCAM_DEALS.name]: { [buyer]: { deals: [deal] } },
    [SCAM_FOUND.name]: {},
    [ENTITY.name]: {},
    [PERSON.name]: { [buyer]: {}, [seller]: {}, [expert]: {} },
  };
  const truth = {
    ids: (t: { name: string }) => Object.keys(tables[t.name] ?? {}),
    get: (t: { name: string }, id: string) => tables[t.name]?.[id],
  } as unknown as ReadonlyWorldTruth;
  const rng = {
    fork: () => rng,
    chance: (p: number) => p > 0.9 || p === APPRAISAL_HAZARD || p === 0.77,
  } as never;
  const ledger = {
    holdings: (a: unknown) => [{ unit: coin, amount: JSON.stringify(a).includes(buyer) ? 5 : 3 }],
  } as never;
  const proc = scamDiscoveryProcess({
    ...(opts.refund !== undefined ? { refund: () => opts.refund as number } : {}),
    placeOf: () => "here" as never,
    eye: (_t, who) => opts.eyes[who] ?? 0,
    appraisers: (_t, who) => opts.eyes[who] ?? 0,
    day: opts.day,
  });
  const ctx = { truth, rng, ledger, now: 1 as Tick } as unknown as ProcessContext;
  return proc.run(ctx) as unknown as {
    events?: { kind: string; data: Record<string, unknown> }[];
    postings?: { transfers: { amount: number }[] }[];
  };
}

describe("estafa: descubrimiento por tasador", () => {
  it("sin un tasador de mejor ojo no hay cobro; con uno, cobra por el ledger y revela la brecha", () => {
    // Tira de chance: solo pasa lo que supera 0,9; el propio ojo no alcanza, el del tasador (brecha + 0,5) sí.
    const none = run({ eyes: { [buyer]: 0.3, [expert]: 0.3 }, day: 0.001 });
    expect(none.postings ?? []).toEqual([]);
    const hired = run({ eyes: { [buyer]: 0.3, [expert]: 0.45 }, day: 0.001 });
    const kinds = (hired.events ?? []).map((e) => e.kind);
    expect(kinds).toContain(SCAM_APPRAISED);
    expect(kinds).toContain("scam.discovered");
    expect(hired.postings?.[0]?.transfers[0]?.amount).toBe(APPRAISAL_FEE);
    const found = hired.events?.find((e) => e.kind === "scam.discovered");
    expect(found?.data["appraiser"]).toBe(expert);
  });

  it("el comprador reclama el sobreprecio: acepta y devuelve por el ledger, o se niega", () => {
    const eyes = { [buyer]: 0.3, [expert]: 0.45 };
    const yes = run({ eyes, day: 0.001, refund: 0.77 });
    const refunded = yes.events?.find((e) => e.kind === "scam.refunded");
    expect(refunded).toBeDefined();
    const back = yes.postings?.[1]?.transfers[0]?.amount ?? 0;
    expect(back).toBeGreaterThan(0);
    expect(back).toBeLessThanOrEqual(3);
    const no = run({ eyes, day: 0.001, refund: 0.1 });
    expect(no.events?.some((e) => e.kind === "scam.refund_refused")).toBe(true);
    expect(no.postings).toHaveLength(1);
    expect(run({ eyes, day: 0.001 }).events?.some((e) => e.kind.startsWith("scam.refund"))).toBe(
      false,
    );
  });
});
