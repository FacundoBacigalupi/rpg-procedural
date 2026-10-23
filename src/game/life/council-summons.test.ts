import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  type EventId,
  type HouseholdId,
  loadContent,
  type OrgId,
  Rng,
  type SettlementId,
} from "../../core/index.ts";
import {
  appearChance,
  CASES,
  type CaseBook,
  ENTITY,
  foundCouncil,
  HOUSEHOLD,
  ORG,
  PERSON,
  RELATIONS,
  type ReadonlyWorldTruth,
  WorldTruth,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { councilCasesProcess } from "./council-cases.ts";
import { Life } from "./life.ts";

const ev = "event:1" as EventId;
const home = "household:1" as HouseholdId;
const sett = "settlement:1" as SettlementId;
const org1 = "org:1" as OrgId;
const kid = "agent:1" as AgentId;
const dad = "agent:2" as AgentId;
const chief = "agent:3" as AgentId;
const elder = "agent:4" as AgentId;
const DAY = 86400;
const rel = (respect: number) => ({
  dims: {
    trust: 0,
    respect,
    affection: 0,
    fear: 0,
    attraction: 0,
    gratitude: 0,
    jealousy: 0,
    resentment: 0,
    familiarity: 0,
    dependency: 0,
  } as never,
  bonds: [],
  history: [],
  updated: 0,
});

function world(respect: number): WorldTruth {
  const w = new WorldTruth();
  for (const [id, born] of [
    [kid, 100],
    [dad, 50],
    [chief, 60],
    [elder, 70],
  ] as const) {
    w.set(ENTITY, id, { id, originEventId: ev, createdAt: 0 } as never);
    w.set(PERSON, id, {
      sex: "male",
      born,
      mother: null,
      father: null,
      household: home,
      spouse: null,
    } as never);
  }
  w.set(HOUSEHOLD, home, { settlement: sett, members: [kid, dad, chief, elder] } as never);
  w.set(RELATIONS, kid, {
    originEventId: ev,
    toward: { [chief]: rel(respect), [elder]: rel(respect) },
  });
  w.set(RELATIONS, chief, { originEventId: ev, toward: { [kid]: rel(0.5) } });
  w.set(RELATIONS, elder, { originEventId: ev, toward: { [kid]: rel(0.5) } });
  w.set(
    ORG,
    org1,
    foundCouncil({
      id: org1,
      settlement: sett,
      elders: [
        { agent: chief, ageYears: 80 },
        { agent: elder, ageYears: 60 },
      ],
      originEventId: ev,
      at: 0,
    }),
  );
  return w;
}

const speak = (id: number, tick: number, belief: number) =>
  ({
    id: `event:${id}`,
    tick,
    kind: "action.speak",
    actors: [chief, dad],
    data: {
      effect: {
        accusation: { accused: kid, deed: "theft", unbacked: false, verdict: "believe", belief },
      },
    },
  }) as never;

interface Out {
  changes?: { table: string; id: string; value: unknown }[];
  events?: { kind: string; data: Record<string, unknown>; causes: unknown[] }[];
}

function run(
  truth: ReadonlyWorldTruth,
  recent: unknown[],
  now: number,
  seed = 1,
  opts: object = { summons: {} },
): Out {
  const proc = councilCasesProcess({
    placeOf: () => ({ kind: "place", id: "place:1" }) as never,
    day: DAY,
    ...opts,
  });
  return (proc.run as unknown as (c: never) => Out)({
    truth,
    recent,
    now,
    rng: Rng.root(seed as never).fork("test", now),
  } as never);
}

const bookOf = (out: Out): CaseBook =>
  out.changes?.find((c) => c.table === CASES.name)?.value as CaseBook;

/** Abre un caso citado (respeto medio) y lo asienta en el mundo. */
function summoned(respect: number, opts?: object): WorldTruth {
  const w = world(respect);
  const out = run(w, [speak(9, 500, 0.9)], 1000, 1, opts);
  w.set(CASES, org1, bookOf(out));
  return w;
}

describe("la citación: el citado comparece o no", () => {
  it("un caso citado lleva el plazo y sigue investigando", () => {
    const out = run(world(0.4), [speak(9, 500, 0.9)], 1000);
    const c = bookOf(out).cases[0];
    expect(c?.status).toBe("investigating");
    expect(c?.summons?.due).toBe(500 + 3 * DAY);
    expect(c?.summons?.outcome).toBeUndefined();
  });

  it("sin la opción summons no hay plazo ni resolución", () => {
    const out = run(world(0.4), [speak(9, 500, 0.9)], 1000, 1, {});
    expect(bookOf(out).cases[0]?.summons).toBeUndefined();
  });

  it("antes del plazo no pasa nada", () => {
    const w = summoned(0.4);
    expect(run(w, [], 500 + 2 * DAY).events ?? []).toEqual([]);
  });

  it("vencido el plazo cada citado comparece o desoye, con causa en la denuncia", () => {
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const out = run(summoned(0.4), [], 500 + 4 * DAY, seed);
      const e = out.events?.[0];
      expect(e).toBeDefined();
      kinds.add(e?.kind ?? "");
      expect(JSON.stringify(e?.causes)).toContain("event:9");
      const c = bookOf(out).cases[0];
      expect(c?.summons?.outcome).toBeDefined();
      expect(c?.status).toBe(e?.kind === "law.summons_defied" ? "defied" : "investigating");
    }
    expect([...kinds].sort()).toEqual(["law.summons_answered", "law.summons_defied"]);
  });

  it("a mayor respeto al consejo, más comparece", () => {
    const rate = (r: number) => {
      let n = 0;
      for (let seed = 1; seed <= 60; seed++) {
        const out = run(summoned(r), [], 500 + 4 * DAY, seed);
        if (out.events?.[0]?.kind === "law.summons_answered") n++;
      }
      return n;
    };
    expect(rate(0.36)).toBeGreaterThan(rate(0.26));
  });

  it("desoír con effects baja el respeto del consejo; no se resuelve dos veces", () => {
    const both = { summons: {}, effects: {} };
    const w = summoned(0.3, both);
    let defied: Out | undefined;
    for (let seed = 1; seed <= 60 && !defied; seed++) {
      const out = run(w, [], 500 + 4 * DAY, seed, both);
      if (out.events?.[0]?.kind === "law.summons_defied") defied = out;
    }
    expect(defied).toBeDefined();
    expect(defied?.events?.map((e) => e.kind)).toContain("law.case_effects");
    const row = defied?.changes?.find((c) => c.table === RELATIONS.name)?.value as {
      toward: Record<string, { dims: { respect: number } }>;
    };
    expect(row.toward[kid]?.dims.respect).toBeLessThan(0.5);
    const again = summoned(0.3);
    const first = run(again, [], 500 + 4 * DAY, 1);
    again.set(CASES, org1, bookOf(first));
    expect(run(again, [], 500 + 9 * DAY, 2).events ?? []).toEqual([]);
  });

  it("un acusado muerto cierra el caso sin comparecer", () => {
    const w = summoned(0.4);
    w.set(ENTITY, kid, { id: kid, originEventId: ev, createdAt: 0, endedAt: 600 } as never);
    const out = run(w, [], 500 + 4 * DAY);
    expect(out.events ?? []).toEqual([]);
    expect(bookOf(out).cases[0]?.status).toBe("dropped");
  });

  it("propiedad: determinista y la probabilidad de comparecer está en [duty, 1] y crece con la autoridad", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.integer({ min: 1, max: 1000 }),
        (respect, loyalty, seed) => {
          const a = run(summoned(respect), [], 500 + 4 * DAY, seed);
          const b = run(summoned(respect), [], 500 + 4 * DAY, seed);
          expect(JSON.stringify(a)).toBe(JSON.stringify(b));
          const p = appearChance({ authority: respect, loyalty });
          expect(p).toBeGreaterThanOrEqual(0.1);
          expect(p).toBeLessThanOrEqual(1);
          const more = appearChance({ authority: Math.min(1, respect + 0.1), loyalty });
          expect(more).toBeGreaterThanOrEqual(p);
        },
      ),
      { numRuns: 40 },
    );
  });
});

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}

describe("councilCases.summons en la vida", () => {
  const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
  it("apagado conserva el hash; encendido es determinista", () => {
    const off = Life.create(3, content, {});
    expect(off.hash().total).toBe(
      "b218098c25ac14a61ca65cbd61b1324438ae2a400978faa2e6bfd7efa9b29f26",
    );
    const on = () => {
      const l = Life.create(3, content, { council: {}, councilCases: { summons: {} } });
      l.advanceTo(l.now + DAY * 5);
      return l.hash().total;
    };
    expect(on()).toBe(on());
  });
});
