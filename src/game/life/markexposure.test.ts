import { describe, expect, it } from "vitest";
import type { AgentId, EventId, Tick } from "../../core/index.ts";
import type { ProcessContext } from "../../sim/index.ts";
import { PERSON, RUMORS } from "../../sim/index.ts";
import {
  believedMarkRenown,
  clearedRenown,
  MARK_CLEARED,
  MARK_CLEARED_EVENT,
  markExposureProcess,
} from "./markexposure.ts";
import { MARK_DEFAULT_RENOWN } from "./marks.ts";
import { FORGERY_RENOWN_BASE, forgeryRenownRumors, renownRumor } from "./moldgossip.ts";

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

describe("la fama del falsificador como creencia", () => {
  it("el fraude oído baja el renown que cree quien lo oyó, por raíz distinta", () => {
    const fraud = (root: string) => ({ root, content: { kind: "fraud", by: forger } });
    const one = forgeryRenownRumors([fraud("e:1"), fraud("e:1")]);
    expect(one).toHaveLength(1);
    expect(one[0]?.rumor).toMatchObject({ attr: "renown", about: forger });
    const two = forgeryRenownRumors([fraud("e:1"), fraud("e:2")]);
    const v = (r: typeof one) => (r[0] as unknown as { rumor: { value: number } }).rumor.value;
    expect(v(two)).toBeLessThan(v(one));
    expect(v(one)).toBeLessThan(FORGERY_RENOWN_BASE);
    expect(forgeryRenownRumors([{ root: "e:3", content: { kind: "theft", by: forger } }])).toEqual(
      [],
    );
  });
  it("el mercado supone el promedio de lo creído; sin creencias, la fama de base", () => {
    const books: Record<string, unknown> = {
      [buyer]: { items: [{ rumor: renownRumor(forger, 0.3) }], told: [] },
      [near]: { items: [{ rumor: renownRumor(forger, 0.1) }], told: [] },
    };
    const truth = (b: Record<string, unknown>) =>
      ({
        get: (t: { name: string }, id: string) =>
          t.name === "law.mold_rumors" ? b[id] : undefined,
        ids: () => [buyer, near, wu],
      }) as never;
    expect(believedMarkRenown(truth(books), forger)).toBeCloseTo(0.2, 9);
    expect(believedMarkRenown(truth({}), forger)).toBe(MARK_DEFAULT_RENOWN);
  });
});
