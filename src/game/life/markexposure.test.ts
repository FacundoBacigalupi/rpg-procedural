import { describe, expect, it } from "vitest";
import type { AgentId, EventId, Tick } from "../../core/index.ts";
import type { ProcessContext } from "../../sim/index.ts";
import { PERSON, RUMORS } from "../../sim/index.ts";
import {
  clearedRenown,
  MARK_CLEARED,
  MARK_CLEARED_EVENT,
  markExposureProcess,
} from "./markexposure.ts";
import { MARK_DEFAULT_RENOWN } from "./marks.ts";

const forger = "agent:2" as AgentId;
const buyer = "agent:1" as AgentId;
const wu = "agent:3" as AgentId;
const near = "agent:4" as AgentId;
const far = "agent:5" as AgentId;

function run(forgedMark: boolean, roll: boolean, reach = false) {
  const tables: Record<string, Record<string, unknown>> = { entity: {}, [RUMORS.name]: {} };
  const truth = {
    get: (t: { name: string }, id: string) => tables[t.name]?.[id],
    ids: (t: { name: string }) => (t.name === PERSON.name ? [buyer, forger, wu, near, far] : []),
  } as never;
  const rng = { fork: () => rng, chance: () => roll } as never;
  const place = (_t: unknown, who: AgentId) => (who === far ? "away" : "here");
  const recent = [
    {
      id: "event:9" as EventId,
      kind: "scam.discovered",
      tick: 3,
      actors: [forger, buyer, wu],
      data: { forgedMark, deal: "event:1" },
    },
  ];
  return markExposureProcess({ placeOf: place as never, ...(reach ? { reach: true } : {}) }).run({
    truth,
    rng,
    recent,
    now: 4 as Tick,
  } as unknown as ProcessContext) as unknown as {
    events?: { kind: string; causes: unknown[] }[];
    changes?: {
      table?: string;
      id?: string;
      value?: { items?: { content: unknown }[] };
    }[];
  };
}

describe("tras la marca falsa descubierta", () => {
  it("el comprador y los vecinos del lugar oyen el fraude y el copiado queda reparado", () => {
    const r = run(true, true);
    expect(r.events?.map((e) => e.kind)).toEqual([MARK_CLEARED_EVENT]);
    expect(r.events?.[0]?.causes).toEqual([{ kind: "event", event: "event:9" }]);
    const heard = (r.changes ?? []).filter((c) => c.value?.items).map((c) => c.id);
    expect(heard).toEqual([buyer, near]);
    expect(r.changes?.some((c) => c.id === wu && c.table === MARK_CLEARED.name)).toBe(true);
    const item = r.changes?.[0]?.value?.items?.[0]?.content as { kind: string; by: string };
    expect(item.kind).toBe("fraud");
    expect(item.by).toBe(forger);
  });
  it("sin la chance los vecinos no se enteran, y sin forgedMark no pasa nada", () => {
    const quiet = run(true, false);
    expect((quiet.changes ?? []).filter((c) => c.value?.items).map((c) => c.id)).toEqual([buyer]);
    expect(run(false, true)).toEqual({});
  });
  it("con reach el rumor llega, más flojo y con más saltos, a quien está en otro lugar", () => {
    const heardBy = (r: ReturnType<typeof run>) =>
      (r.changes ?? []).filter((c) => c.value?.items).map((c) => c.id);
    expect(heardBy(run(true, true))).not.toContain(far);
    const r = run(true, true, true);
    expect(heardBy(r)).toContain(far);
    const c = r.changes?.find((x) => x.id === far) as unknown as {
      value: { items: { hops: number; confidence: number }[] };
    };
    expect(c.value.items[0]?.hops).toBe(2);
    expect(c.value.items[0]?.confidence).toBeLessThan(0.6);
    expect(heardBy(run(true, false, true))).toEqual([buyer]);
  });
});

describe("la fama que el mercado le supone al copiado", () => {
  it("sube con cada vez que se supo que su marca era falsa, hasta 1", () => {
    const withCount = (n: number) =>
      ({
        get: () => ({ entries: Array.from({ length: n }, () => ({})) }),
      }) as never;
    expect(clearedRenown(withCount(0), wu)).toBe(MARK_DEFAULT_RENOWN);
    expect(clearedRenown(withCount(2), wu)).toBeCloseTo(0.7, 9);
    expect(clearedRenown(withCount(16), wu)).toBe(1);
  });
});
