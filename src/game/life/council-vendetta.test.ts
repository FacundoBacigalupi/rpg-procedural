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
  type CaseBook,
  ENTITY,
  foundCouncil,
  HOUSEHOLD,
  MAX_VENDETTA_STAGE,
  ORG,
  PERSON,
  RELATIONS,
  type ReadonlyWorldTruth,
  vendettaChance,
  WorldTruth,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { councilCasesProcess } from "./council-cases.ts";
import { Life } from "./life.ts";

const ev = "event:1" as EventId;
const home = "household:1" as HouseholdId;
const home2 = "household:2" as HouseholdId;
const sett = "settlement:1" as SettlementId;
const org1 = "org:1" as OrgId;
const kid = "agent:1" as AgentId;
const dad = "agent:2" as AgentId;
const chief = "agent:3" as AgentId;
const elder = "agent:4" as AgentId;
const uncle = "agent:5" as AgentId;
const DAY = 86400;
const rel = (resentment: number) => ({
  dims: {
    trust: 0,
    respect: 0.2,
    affection: 0,
    fear: 0,
    attraction: 0,
    gratitude: 0,
    jealousy: 0,
    resentment,
    familiarity: 0,
    dependency: 0,
  } as never,
  bonds: [],
  history: [],
  updated: 0,
});

/** El acusado (kid) y el acusador (dad, con su tío en casa); el consejo es chief y elder. */
function world(resentment = 0.5): WorldTruth {
  const w = new WorldTruth();
  for (const [id, h] of [
    [kid, home],
    [dad, home2],
    [uncle, home2],
    [chief, home],
    [elder, home],
  ] as const) {
    w.set(ENTITY, id, { id, originEventId: ev, createdAt: 0 } as never);
    w.set(PERSON, id, {
      sex: "male",
      born: 50,
      mother: null,
      father: null,
      household: h,
      spouse: null,
    } as never);
  }
  w.set(HOUSEHOLD, home, { settlement: sett, members: [kid, chief, elder] } as never);
  w.set(HOUSEHOLD, home2, { settlement: sett, members: [dad, uncle] } as never);
  w.set(RELATIONS, dad, { originEventId: ev, toward: { [kid]: rel(resentment) } });
  w.set(RELATIONS, uncle, { originEventId: ev, toward: { [kid]: rel(0) } });
  w.set(RELATIONS, kid, { originEventId: ev, toward: { [dad]: rel(0) } });
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

interface Out {
  changes?: { table: string; id: string; value: unknown }[];
  events?: { kind: string; data: Record<string, unknown>; causes: unknown[] }[];
}

const kase = (status: string, response: string, belief = 0.9) => ({
  id: `${org1}#1`,
  forum: org1,
  accuser: dad,
  accused: kid,
  claimed: "theft",
  facts: [],
  judge: chief,
  belief,
  response,
  status,
  openedAt: 100,
  originEventId: "event:9",
});

function withCase(w: WorldTruth, c: object): WorldTruth {
  w.set(CASES, org1, { cases: [c], serial: 1 } as never);
  return w;
}

function run(
  truth: ReadonlyWorldTruth,
  now: number,
  seed = 1,
  opts: object = { vendetta: {} },
): Out {
  const proc = councilCasesProcess({
    placeOf: () => ({ kind: "place", id: "place:1" }) as never,
    day: DAY,
    ...opts,
  });
  return (proc.run as unknown as (c: never) => Out)({
    truth,
    recent: [],
    now,
    rng: Rng.root(seed as never).fork("test", now),
  } as never);
}

const bookOf = (out: Out): CaseBook =>
  out.changes?.find((c) => c.table === CASES.name)?.value as CaseBook;

/** Primer seed donde la decisión es declarar. */
function declared(w: WorldTruth, now = 1000) {
  for (let seed = 1; seed <= 80; seed++) {
    const out = run(w, now, seed);
    if (bookOf(out)?.cases[0]?.vendetta?.status === "active") return out;
  }
  throw new Error("nunca declaró");
}

describe("la vendetta del acusador", () => {
  it("un citado que desoyó puede declarar la vendetta, con su linaje y causa en la denuncia", () => {
    const out = declared(withCase(world(), kase("defied", "summon")));
    const v = bookOf(out).cases[0]?.vendetta;
    expect(v?.reason).toBe("defied");
    expect(v?.stage).toBe(1);
    expect(v?.kin).toEqual([uncle]);
    const e = out.events?.find((x) => x.kind === "law.vendetta_declared");
    expect(JSON.stringify(e?.causes)).toContain("event:9");
    const dad2 = out.changes?.find((c) => c.table === RELATIONS.name)?.value as never as {
      toward: Record<string, { dims: { resentment: number } }>;
    };
    expect(dad2).toBeDefined();
  });

  it("también cuando el foro quería sancionar y no pudo (descartado)", () => {
    const out = declared(withCase(world(), kase("dropped", "sanction")));
    expect(bookOf(out).cases[0]?.vendetta?.reason).toBe("unreached");
  });

  it("no hay vendetta si el consejo sí alcanzó, mediaron o ignoró", () => {
    for (const [s, r] of [
      ["decided", "sanction"],
      ["settled", "mediate"],
      ["dropped", "ignore"],
      ["investigating", "summon"],
    ] as const) {
      const out = run(withCase(world(), kase(s, r)), 1000);
      expect(out.events ?? []).toEqual([]);
    }
  });

  it("se decide una sola vez, aun si dijo que no", () => {
    const w = withCase(world(), kase("defied", "summon"));
    const first = run(w, 1000, 1);
    w.set(CASES, org1, bookOf(first));
    expect(run(w, 1000 + DAY, 2).events ?? []).toEqual([]);
  });

  it("escala por etapas hasta el tope y se cierra; nunca pasa del tope", () => {
    const w = withCase(world(), kase("defied", "summon"));
    let out = declared(w);
    let now = 1000;
    let stage = 1;
    const kinds: string[] = [];
    for (let i = 0; i < 8; i++) {
      w.set(CASES, org1, bookOf(out));
      now += 11 * DAY;
      out = run(w, now, i + 1);
      for (const e of out.events ?? []) kinds.push(e.kind);
      const v = bookOf(out)?.cases[0]?.vendetta;
      if (v) stage = v.stage;
      expect(stage).toBeLessThanOrEqual(MAX_VENDETTA_STAGE);
      if (v?.status === "closed") break;
    }
    expect(kinds).toContain("law.vendetta_escalated");
    expect(kinds.at(-1)).toBe("law.vendetta_closed");
  });

  it("el rencor enfriado la cierra; acusado muerto no declara", () => {
    const w = withCase(world(0), kase("defied", "summon", 0.9));
    const open = declared(w);
    const cooled = withCase(world(0), bookOf(open).cases[0] as object);
    const out = run(cooled, 1000 + 11 * DAY);
    expect(out.events?.[0]?.kind).toBe("law.vendetta_closed");
    const dead = withCase(world(), kase("defied", "summon"));
    dead.set(ENTITY, kid, { id: kid, originEventId: ev, createdAt: 0, endedAt: 600 } as never);
    expect(run(dead, 1000).events ?? []).toEqual([]);
  });

  it("sin la opción vendetta no existe nada de esto", () => {
    expect(run(withCase(world(), kase("defied", "summon")), 1000, 1, {}).events ?? []).toEqual([]);
  });

  it("propiedad: la probabilidad está en [0, 1], crece con el agravio y baja con la lealtad", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.constantFrom("defied", "unreached"),
        (belief, resentment, loyalty, reason) => {
          const p = vendettaChance({ belief, resentment, loyalty, reason });
          expect(p).toBeGreaterThanOrEqual(0);
          expect(p).toBeLessThanOrEqual(1);
          expect(
            vendettaChance({ belief, resentment: Math.min(1, resentment + 0.1), loyalty, reason }),
          ).toBeGreaterThanOrEqual(p);
          expect(
            vendettaChance({ belief, resentment, loyalty: Math.min(1, loyalty + 0.1), reason }),
          ).toBeLessThanOrEqual(p);
          expect(
            vendettaChance({ belief, resentment, loyalty, reason: "defied" }),
          ).toBeGreaterThanOrEqual(
            vendettaChance({ belief, resentment, loyalty, reason: "unreached" }),
          );
        },
      ),
      { numRuns: 60 },
    );
  });

  it("propiedad: determinista y el rencor sigue en [0, 1]", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.integer({ min: 1, max: 500 }),
        (resentment, seed) => {
          const mk = () => run(withCase(world(resentment), kase("defied", "summon")), 1000, seed);
          const a = mk();
          expect(JSON.stringify(a)).toBe(JSON.stringify(mk()));
          for (const c of a.changes ?? []) {
            if (c.table !== RELATIONS.name) continue;
            const row = c.value as { toward: Record<string, { dims: { resentment: number } }> };
            for (const r of Object.values(row.toward)) {
              expect(r.dims.resentment).toBeGreaterThanOrEqual(0);
              expect(r.dims.resentment).toBeLessThanOrEqual(1);
            }
          }
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

describe("councilCases.vendetta en la vida", () => {
  const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
  it("apagado conserva el hash; encendido es determinista", () => {
    expect(Life.create(3, content, {}).hash().total).toBe(
      "b829bb7436cffc764da33660c899d578132ea796fdf7f86e47af651e5310c12f",
    );
    const on = () => {
      const l = Life.create(3, content, {
        council: {},
        councilCases: { summons: {}, vendetta: {} },
      });
      l.advanceTo(l.now + DAY * 5);
      return l.hash().total;
    };
    expect(on()).toBe(on());
  });
});
