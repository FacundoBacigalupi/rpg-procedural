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
  RELATION_BONDS,
  RELATION_DIMS,
  RELATIONS,
  type ReadonlyWorldTruth,
  spokenWeight,
  TRAITS,
  WorldTruth,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { councilCasesProcess } from "./council-cases.ts";
import { Life } from "./life.ts";

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}
const content = loadContent(GAME_CONTENT_KINDS, sources("content"));

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
const now = 500 + 3 * DAY;

const rel = (over: Record<string, number> = {}) => ({
  dims: {
    trust: 0,
    respect: 0.9,
    affection: 0,
    fear: 0,
    attraction: 0,
    gratitude: 0,
    jealousy: 0,
    resentment: 0,
    familiarity: 0,
    dependency: 0,
    ...over,
  } as never,
  bonds: [],
  history: [],
  updated: now,
});

/** El elder guarda el hecho (kid lo hizo) y siente `toKid` hacia el acusado; el chief no sabe nada. */
function world(toKid: Record<string, number>, toOther: Record<string, number> = {}): WorldTruth {
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
  w.set(RELATIONS, kid, { originEventId: ev, toward: { [chief]: rel(), [elder]: rel() } });
  w.set(RELATIONS, chief, { originEventId: ev, toward: { [kid]: rel() } });
  w.set(RELATIONS, elder, {
    originEventId: ev,
    toward: { [kid]: rel(toKid), [other]: rel(toOther) },
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
  w.set(KNOWN_DEEDS, elder, {
    deeds: [{ kind: "theft", by: kid, victim: dad, event: theftEv, at: 10, via: "saw" }],
  } as never);
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
    summons: { due: 500 + DAY, outcome: "appeared" } as never,
  };
  w.set(CASES, org1, { cases: [c], serial: 1 });
  return w;
}

interface Out {
  changes?: { table: string; value: unknown }[];
  events?: { kind: string; data: Record<string, unknown> }[];
}

function run(truth: ReadonlyWorldTruth, opts: object = { investigation: { testimony: {} } }): Out {
  const proc = councilCasesProcess({
    placeOf: () => ({ kind: "place", id: "place:1" }) as never,
    day: DAY,
    dims: content.all(RELATION_DIMS),
    bonds: content.all(RELATION_BONDS),
    traits: content.all(TRAITS),
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

describe("testigos que mienten o callan en el consejo", () => {
  it("sin miedo ni lealtad el testigo cuenta lo que recuerda y deja indicio", () => {
    const out = run(world({}));
    const t = out.events?.find((e) => e.kind === "law.council_testimony");
    expect(t?.data["said"]).toBe(true);
    expect(caseOf(out).investigation?.clues).toBe(1);
  });

  it("con mucho miedo al acusado el testigo calla: sin indicio y queda registrado", () => {
    const out = run(world({ fear: 1 }));
    const t = out.events?.find((e) => e.kind === "law.council_testimony");
    expect(t?.data["said"]).toBe(false);
    expect(caseOf(out).investigation?.clues).toBe(0);
    const inv = out.events?.find((e) => e.kind === "law.case_investigated");
    expect(inv?.data["silent"]).toEqual([elder]);
    expect(inv?.data["truthOf"]).toEqual({ lies: 1 });
  });

  it("con odio a un tercero no sube la creencia del foro más que el testigo veraz", () => {
    const base = caseOf(run(world({}))).investigation;
    const out = run(world({ affection: 1, gratitude: 1 }, { resentment: 1 }));
    const inv = caseOf(out).investigation;
    expect(inv?.beliefAfter).toBeLessThanOrEqual(base?.beliefAfter ?? 1);
  });

  it("sin la sub-opción no declara: usa lo guardado y no emite testimonios", () => {
    const out = run(world({ fear: 1 }), { investigation: {} });
    expect(out.events?.some((e) => e.kind === "law.council_testimony")).toBe(false);
    expect(caseOf(out).investigation?.clues).toBe(1);
  });

  it("determinista", () => {
    const mk = () => JSON.stringify(run(world({ fear: 0.6, affection: 0.4 })));
    expect(mk()).toBe(mk());
  });

  it("propiedad: spokenWeight en [0,1], monótono en la firmeza y nulo si no dijo", () => {
    // La salida se redondea a seis decimales: una base sin cuantizar puede
    // crecer como máximo media unidad de esa precisión, no solo 1e-9.
    expect(spokenWeight(0.0000008, 1, true)).toBe(0.000001);
    expect(spokenWeight(0.000015500000000000004, 0.9999999999999996, true)).toBe(0.000016);
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (base, a, b) => {
          const lo = spokenWeight(base, Math.min(a, b), true) as number;
          const hi = spokenWeight(base, Math.max(a, b), true) as number;
          expect(lo).toBeGreaterThanOrEqual(0);
          expect(hi).toBeLessThanOrEqual(1);
          expect(hi).toBeGreaterThanOrEqual(lo);
          expect(hi).toBeLessThanOrEqual(base + 0.0000005 + Number.EPSILON);
          // Las bases reales de testimonyWeight ya tienen esa precisión:
          // en ese dominio sí se conserva el tope estricto de la base.
          const canonicalBase = Math.round(base * 1e6) / 1e6;
          expect(spokenWeight(canonicalBase, Math.max(a, b), true)).toBeLessThanOrEqual(
            canonicalBase,
          );
          expect(spokenWeight(base, a, false)).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("councilCases.investigation.testimony en la vida", () => {
  it("apagado conserva el hash; encendido es determinista", () => {
    expect(Life.create(3, content, {}).hash().total).toBe(
      "b829bb7436cffc764da33660c899d578132ea796fdf7f86e47af651e5310c12f",
    );
    const on = () => {
      const l = Life.create(3, content, {
        council: {},
        councilCases: { summons: {}, investigation: { testimony: {} } },
      });
      l.advanceTo(l.now + DAY * 5);
      return l.hash().total;
    };
    expect(on()).toBe(on());
  });
});
