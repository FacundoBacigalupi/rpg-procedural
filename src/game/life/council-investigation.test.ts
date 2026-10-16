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
  balanceClues,
  CASES,
  type Case,
  type CaseBook,
  type Clue,
  ENTITY,
  foundCouncil,
  HOUSEHOLD,
  KNOWN_DEEDS,
  ORG,
  PERSON,
  RELATIONS,
  type ReadonlyWorldTruth,
  resolveInvestigation,
  TRACE,
  updateBelief,
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
const other = "agent:5" as AgentId;
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

const deed = (by: AgentId | null, via: "saw" | "heard" | "told" = "saw") =>
  ({ kind: "theft", by, victim: dad, event: theftEv, at: 10, via }) as never;

function openCase(over: Partial<Case> = {}): Case {
  return {
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
    ...over,
  };
}

/** Un consejo de dos ancianos, el acusado con el respeto dado y un caso investigando. */
function world(
  respect: number,
  deeds: Record<string, unknown[]>,
  c: Case = openCase(),
): WorldTruth {
  const w = new WorldTruth();
  for (const id of [kid, dad, chief, elder, other]) {
    w.set(ENTITY, id, { id, originEventId: ev, createdAt: 0 } as never);
    w.set(PERSON, id, {
      sex: "male",
      born: id === kid ? 100 : 50,
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
  for (const [who, list] of Object.entries(deeds))
    w.set(KNOWN_DEEDS, who as AgentId, { deeds: list } as never);
  w.set(CASES, org1, { cases: [c], serial: 1 });
  return w;
}

interface Out {
  changes?: { table: string; id: string; value: unknown }[];
  events?: {
    kind: string;
    data: Record<string, unknown> & { witnesses?: unknown };
    causes: unknown[];
  }[];
}

function run(truth: ReadonlyWorldTruth, now: number, opts: object = { investigation: {} }): Out {
  const proc = councilCasesProcess({
    placeOf: () => ({ kind: "place", id: "place:1" }) as never,
    day: DAY,
    ...opts,
  });
  return (proc.run as unknown as (c: never) => Out)({
    truth,
    recent: [],
    now,
    rng: Rng.root(1 as never).fork("test", now),
  } as never);
}

const caseOf = (out: Out): Case =>
  ((out.changes?.find((c) => c.table === CASES.name)?.value ?? { cases: [] }) as CaseBook)
    .cases[0] as Case;

describe("investigación del consejo (puro)", () => {
  const clue = (points: AgentId | null, weight: number, source = elder): Clue => ({
    kind: "testimony",
    source,
    points,
    weight,
    event: theftEv,
  });

  it("los indicios que señalan al acusado suben la creencia y los que señalan a otro la bajan", () => {
    const up = updateBelief(0.6, balanceClues([clue(kid, 0.9)], kid));
    const down = updateBelief(0.6, balanceClues([clue(other, 0.9)], kid));
    expect(up).toBeGreaterThan(0.6);
    expect(down).toBeLessThan(0.6);
    expect(updateBelief(0.6, balanceClues([clue(null, 1)], kid))).toBe(0.6);
  });

  it("propiedad: la creencia queda en [0,1], es determinista y más testigos a favor no la bajan", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { maxLength: 6 }),
        fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { maxLength: 6 }),
        (prior, pro, con) => {
          const clues = [...pro.map((w) => clue(kid, w)), ...con.map((w) => clue(other, w))];
          const a = updateBelief(prior, balanceClues(clues, kid));
          expect(a).toBeGreaterThanOrEqual(0);
          expect(a).toBeLessThanOrEqual(1);
          expect(a).toBe(updateBelief(prior, balanceClues(clues, kid)));
          const more = updateBelief(prior, balanceClues([...clues, clue(kid, 0.5)], kid));
          expect(more).toBeGreaterThanOrEqual(a - 1e-9);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("sin indicios el foro que solo cita no sanciona: media", () => {
    const c = resolveInvestigation(
      openCase({ belief: 0.9 }),
      { clues: 0, for: 0, against: 0 },
      { authority: 0.3, loyalty: 0 },
      1,
      1000,
    );
    expect(c.status).toBe("settled");
    expect(c.investigation?.clues).toBe(0);
  });
});

describe("el consejo investiga el caso", () => {
  const now = 500 + 3 * DAY;
  const answered = (): Case =>
    openCase({ summons: { due: 500 + DAY, outcome: "appeared", resolvedAt: 500 + DAY } });

  it("un testigo que vio al acusado sanciona a quien el consejo respeta poco... y queda con causa", () => {
    const w = world(0.9, { [elder]: [deed(kid)] }, answered());
    const out = run(w, now);
    const c = caseOf(out);
    expect(c.investigation?.clues).toBe(1);
    expect(c.investigation?.beliefAfter).toBeGreaterThan(0.6);
    expect(c.status).toBe("decided");
    const kinds = out.events?.map((e) => e.kind);
    expect(kinds).toEqual(["law.case_investigated", "law.case_resolved"]);
    expect(JSON.stringify(out.events?.[0]?.causes)).toContain("event:9");
    expect(out.events?.[0]?.data.witnesses).toEqual([elder]);
  });

  it("un testigo que vio a otro desmonta la denuncia", () => {
    const w = world(0.9, { [elder]: [deed(other)], [chief]: [deed(other)] }, answered());
    const c = caseOf(run(w, now));
    expect(c.investigation?.against).toBeGreaterThan(0.5);
    expect(c.status).not.toBe("decided");
  });

  it("una huella visible atada a un hecho que el testigo sabe suma un indicio", () => {
    const w = world(0.9, { [elder]: [deed(kid, "told")] }, answered());
    const base = caseOf(run(w, now)).investigation?.for ?? 0;
    w.set(
      TRACE,
      "trace:1" as never,
      {
        kind: "blood",
        at: { hex: 1 },
        made: now - 3600,
        by: [kid],
        event: theftEv,
        strength: 0.8,
      } as never,
    );
    const c = caseOf(run(w, now));
    expect(c.investigation?.clues).toBe(2);
    expect(c.investigation?.for).toBeGreaterThan(base);
  });

  it("no mira la verdad: un hecho que nadie del foro sabe no cuenta aunque haya huella", () => {
    const w = world(0.9, {}, answered());
    w.set(
      TRACE,
      "trace:1" as never,
      {
        kind: "blood",
        at: { hex: 1 },
        made: now - 3600,
        by: [kid],
        event: theftEv,
        strength: 0.8,
      } as never,
    );
    expect(caseOf(run(w, now)).investigation?.clues).toBe(0);
  });

  it("espera a que el citado comparezca; sin citación espera el plazo; no investiga dos veces", () => {
    const pending = openCase({ summons: { due: 500 + DAY } });
    expect(run(world(0.9, { [elder]: [deed(kid)] }, pending), now).events ?? []).toEqual([]);
    const plain = world(0.9, { [elder]: [deed(kid)] });
    expect(run(plain, 500 + DAY).events ?? []).toEqual([]);
    const out = run(plain, 500 + 3 * DAY);
    expect(caseOf(out).investigation).toBeDefined();
    plain.set(CASES, org1, { cases: [caseOf(out)], serial: 1 });
    expect(run(plain, 500 + 9 * DAY).events ?? []).toEqual([]);
  });

  it("sin la opción no investiga; el acusado muerto archiva", () => {
    const w = world(0.9, { [elder]: [deed(kid)] }, answered());
    expect(run(w, now, {}).events ?? []).toEqual([]);
    w.set(ENTITY, kid, { id: kid, originEventId: ev, createdAt: 0, endedAt: 600 } as never);
    expect(caseOf(run(w, now)).status).toBe("dropped");
  });

  it("con effects la sanción investigada mueve el respeto del consejo", () => {
    const w = world(0.9, { [elder]: [deed(kid)] }, answered());
    const out = run(w, now, { investigation: {}, effects: {} });
    expect(out.events?.map((e) => e.kind)).toContain("law.case_effects");
  });

  it("determinista", () => {
    const mk = () =>
      run(world(0.9, { [elder]: [deed(kid)], [chief]: [deed(kid, "heard")] }, answered()), now);
    expect(JSON.stringify(mk())).toBe(JSON.stringify(mk()));
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

describe("councilCases.investigation en la vida", () => {
  const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
  it("apagado conserva el hash; encendido es determinista", () => {
    expect(Life.create(3, content, {}).hash().total).toBe(
      "b829bb7436cffc764da33660c899d578132ea796fdf7f86e47af651e5310c12f",
    );
    const on = () => {
      const l = Life.create(3, content, {
        council: {},
        councilCases: { summons: {}, investigation: {} },
      });
      l.advanceTo(l.now + DAY * 5);
      return l.hash().total;
    };
    expect(on()).toBe(on());
  });
});
