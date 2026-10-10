import { describe, expect, it } from "vitest";
import type { AgentId, EventId, Tick } from "../../core/index.ts";
import type { ProcessContext, ReadonlyWorldTruth } from "../../sim/index.ts";
import { optInParts } from "./create.ts";
import { LOT_MARKS, MARK_STAMPED, MARK_VERIFIED, marksProcess } from "./marks.ts";

const buyer = "agent:1" as AgentId;
const seller = "agent:2" as AgentId;

function run(direction: "buy" | "sell", roll: number, deal = true) {
  const tables: Record<string, Record<string, unknown>> = { [LOT_MARKS.name]: {}, entity: {} };
  const truth = { get: (t: { name: string }, id: string) => tables[t.name]?.[id] } as never;
  const rng = { fork: () => rng, float: () => roll } as never;
  const actor = direction === "buy" ? buyer : seller;
  const other = direction === "buy" ? seller : buyer;
  const recent = [
    {
      id: "event:9" as EventId,
      actors: [actor],
      data: {
        effect: {
          kind: "trade",
          with: other,
          deal,
          direction,
          good: "good:grain",
          grams: 500,
          quality: 0.6,
        },
      },
    },
  ];
  const ctx = {
    truth: truth as ReadonlyWorldTruth,
    rng,
    recent,
    now: 3 as Tick,
  } as unknown as ProcessContext;
  return marksProcess({ placeOf: () => "here" as never, eye: () => 0.5 }).run(ctx) as unknown as {
    events?: { kind: string; causes: unknown[]; data: Record<string, unknown> }[];
    changes?: { id?: string }[];
  };
}

describe("marcas en el lote", () => {
  it("el trato marca el lote y el comprador lo verifica, con causa en el trato", () => {
    for (const dir of ["buy", "sell"] as const) {
      const r = run(dir, 0.5);
      expect(r.events?.map((e) => e.kind)).toEqual([MARK_STAMPED, MARK_VERIFIED]);
      expect(r.events?.every((e) => e.causes.length === 1)).toBe(true);
      expect(r.changes?.[0]?.id).toBe(buyer);
      expect(r.events?.[1]?.data["seemsForged"]).toBe(false);
    }
  });
  it("sin trato no hay marca", () => {
    expect(run("buy", 0.5, false).events).toBeUndefined();
  });
  it("apagado por defecto", () => {
    expect(optInParts({})).toEqual({});
    expect(optInParts({ marks: true })).toEqual({ marks: true });
  });
});
