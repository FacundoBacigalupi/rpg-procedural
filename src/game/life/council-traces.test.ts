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
  CASES,
  type Case,
  type CaseBook,
  ENTITY,
  foundCouncil,
  HOUSEHOLD,
  KNOWN_DEEDS,
  ORG,
  PERSON,
  RELATIONS,
  type ReadonlyWorldTruth,
  readTrace,
  TRACE,
  TRACE_VISIBLE,
  WorldTruth,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { councilCasesProcess } from "./council-cases.ts";
import { Life } from "./life.ts";

const ev = "event:1" as EventId;
const theftEv = "event:7" as EventId;
const home = "household:1" as HouseholdId;
const sett = "settlement:1" as SettlementId;
const org1 = "org:1" as OrgId;
const kid = "agent:1" as AgentId;
const dad = "agent:2" as AgentId;
const chief = "agent:3" as AgentId;
const elder = "agent:4" as AgentId;
const DAY = 86400;
const rel = (respect: number) =>
  ({
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
    },
    bonds: [],
    history: [],
    updated: 0,
  }) as never;

const deed = () => ({ kind: "theft", by: kid, victim: dad, event: theftEv, at: 10, via: "saw" });

function world(now: number, strength: number, at: { hex: number; space?: string }): WorldTruth {
  const w = new WorldTruth();
  for (const id of [kid, dad, chief, elder]) {
    w.set(ENTITY, id, { id, originEventId: ev, createdAt: 0 } as never);
    w.set(PERSON, id, {
      sex: "male",
      born: 50,
      mother: null,
      father: null,
      household: home,
      spouse: null,
    } as never);
  }
  w.set(HOUSEHOLD, home, { settlement: sett, members: [kid, dad, chief, elder] } as never);
  w.set(RELATIONS, kid, {
    originEventId: ev,
    toward: { [chief]: rel(0.9), [elder]: rel(0.9) },
  });
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
  w.set(KNOWN_DEEDS, elder, { deeds: [deed()] } as never);
  const c: Case = {
    id: `${org1}#1`,
    forum: org1,
    accuser: dad,
    accused: kid,
    claimed: "theft",
    facts: [theftEv],
    judge: chief,
    belief: 0.6,
    response: "summon",
    status: "investigating",
    openedAt: 500,
    originEventId: "event:9" as EventId,
    summons: { due: 500 + DAY, outcome: "appeared", resolvedAt: 500 + DAY },
  };
  w.set(CASES, org1, { cases: [c], serial: 1 });
  w.set(
    TRACE,
    "trace:1" as never,
    { kind: "blood", at, made: now - 3600, by: [kid], event: theftEv, strength } as never,
  );
  return w;
}

interface Out {
  changes?: { table: string; value: unknown }[];
  events?: {
    kind: string;
    data: { seen?: boolean; truthOf?: { erased: boolean } };
    causes: unknown[];
  }[];
}

function run(truth: ReadonlyWorldTruth, now: number, extra: object = {}): Out {
  const proc = councilCasesProcess({
    placeOf: () => ({ kind: "place", id: "place:1" }) as never,
    day: DAY,
    investigation: { traces: {} },
    ...extra,
  });
  return (proc.run as unknown as (c: never) => Out)({
    truth,
    recent: [],
    now,
    rng: Rng.root(1 as never).fork("test", now),
  } as never);
}

const bookOf = (o: Out) =>
  (o.changes?.find((c) => c.table === CASES.name)?.value ?? { cases: [] }) as CaseBook;
const inspected = (o: Out) => (o.events ?? []).filter((e) => e.kind === "law.trace_inspected");
const nows = Array.from({ length: 12 }, (_, i) => 500 + 3 * DAY + i * 17);

describe("readTrace (puro)", () => {
  const look = { acuity: 1, attention: 1 };
  it("lo borrado no se ve y lo fuerte casi siempre", () => {
    expect(readTrace(TRACE_VISIBLE / 2, look, Rng.root(1 as never)).erased).toBe(true);
    let seen = 0;
    for (let i = 0; i < 200; i++) if (readTrace(0.9, look, Rng.root(i as never)).seen) seen += 1;
    expect(seen).toBeGreaterThan(170);
  });

  it("propiedad: percibido en [0,1], determinista, más fuerza no se ve menos en promedio", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0.3, max: 2, noNaN: true }),
        fc.integer({ min: 0, max: 1000 }),
        (s, acuity, seed) => {
          const l = { acuity, attention: 1 };
          const a = readTrace(s, l, Rng.root(seed as never));
          expect(a).toEqual(readTrace(s, l, Rng.root(seed as never)));
          expect(a.perceived).toBeGreaterThanOrEqual(0);
          expect(a.perceived).toBeLessThanOrEqual(1);
          if (!a.seen) expect(a.perceived).toBe(0);
        },
      ),
      { numRuns: 200 },
    );
    const rate = (s: number) => {
      let n = 0;
      for (let i = 0; i < 300; i++) if (readTrace(s, look, Rng.root(i as never)).seen) n += 1;
      return n;
    };
    expect(rate(0.8)).toBeGreaterThanOrEqual(rate(0.15));
  });
});

describe("el consejo mira las huellas en el lugar", () => {
  it("una huella fuerte a la intemperie se percibe y suma un indicio con causa", () => {
    let seen = 0;
    for (const now of nows) {
      const o = run(world(now, 0.9, { hex: 1 }), now);
      const ins = inspected(o);
      expect(ins).toHaveLength(1);
      expect(JSON.stringify(ins[0]?.causes)).toContain("event:9");
      const inv = bookOf(o).cases[0]?.investigation;
      if (ins[0]?.data.seen) {
        seen += 1;
        expect(inv?.clues).toBe(2);
      } else expect(inv?.clues).toBe(1);
    }
    expect(seen).toBeGreaterThan(8);
  });

  it("la lluvia borra la de afuera pero no la de adentro", () => {
    const rain = () => 60;
    for (const now of nows) {
      const out = run(world(now, 0.6, { hex: 1 }), now, { rain });
      expect(inspected(out)[0]?.data.seen).toBe(false);
      expect(inspected(out)[0]?.data.truthOf?.erased).toBe(true);
      expect(bookOf(out).cases[0]?.investigation?.clues).toBe(1);
    }
    let seen = 0;
    for (const now of nows) {
      const inside = run(world(now, 0.9, { hex: 1, space: "space:1" }), now, { rain });
      if (inspected(inside)[0]?.data.seen) seen += 1;
    }
    expect(seen).toBeGreaterThan(8);
  });

  it("el tiempo también la borra", () => {
    const now = 500 + 3 * DAY;
    const w = world(now, 0.5, { hex: 1 });
    w.set(
      TRACE,
      "trace:1" as never,
      {
        kind: "blood",
        at: { hex: 1 },
        made: now - 20 * DAY,
        by: [kid],
        event: theftEv,
        strength: 0.5,
      } as never,
    );
    const o = run(w, now);
    expect(inspected(o)[0]?.data.truthOf?.erased).toBe(true);
  });

  it("nunca la verdad: sin un hecho que el foro sepa de quién es, nadie la mira", () => {
    const now = 500 + 3 * DAY;
    const w = world(now, 0.9, { hex: 1 });
    w.set(KNOWN_DEEDS, elder, { deeds: [] } as never);
    const o = run(w, now);
    expect(inspected(o)).toHaveLength(0);
    expect(bookOf(o).cases[0]?.investigation?.clues).toBe(0);
  });

  it("sin traces la huella se lee como antes y no hay inspección", () => {
    const now = 500 + 3 * DAY;
    const o = run(world(now, 0.9, { hex: 1 }), now, { investigation: {} });
    expect(inspected(o)).toHaveLength(0);
    expect(bookOf(o).cases[0]?.investigation?.clues).toBe(2);
  });

  it("determinista", () => {
    const now = 500 + 3 * DAY;
    const mk = () => JSON.stringify(run(world(now, 0.7, { hex: 1 }), now, { rain: () => 3 }));
    expect(mk()).toBe(mk());
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

describe("councilCases.investigation.traces en la vida", () => {
  const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
  it("apagado conserva el hash; encendido es determinista", () => {
    expect(Life.create(3, content, {}).hash().total).toBe(
      "b829bb7436cffc764da33660c899d578132ea796fdf7f86e47af651e5310c12f",
    );
    const on = () => {
      const l = Life.create(3, content, {
        council: {},
        councilCases: { summons: {}, investigation: { traces: {} } },
      });
      l.advanceTo(l.now + DAY * 5);
      return l.hash().total;
    };
    expect(on()).toBe(on());
  });
});
