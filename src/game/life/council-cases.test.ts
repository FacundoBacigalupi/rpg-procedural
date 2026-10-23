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
  type SettlementId,
} from "../../core/index.ts";
import {
  CASES,
  type CaseBook,
  ENTITY,
  foundCouncil,
  HOUSEHOLD,
  KNOWN_DEEDS,
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
const kid = "agent:1" as AgentId; // el acusado
const dad = "agent:2" as AgentId; // quien acusa
const chief = "agent:3" as AgentId;
const elder = "agent:4" as AgentId;
const DAY = 86400;
const dims = (respect: number) =>
  ({
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
  }) as never;
const rel = (respect: number) => ({ dims: dims(respect), bonds: [], history: [], updated: 0 });

function world(respect: number, withCouncil = true): WorldTruth {
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
  if (withCouncil) {
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
  }
  return w;
}

const speak = (
  id: number,
  tick: number,
  belief: number,
  verdict: string,
  listener: AgentId = chief,
) =>
  ({
    id: `event:${id}`,
    tick,
    kind: "action.speak",
    actors: [listener, dad],
    data: {
      effect: { accusation: { accused: kid, deed: "theft", unbacked: false, verdict, belief } },
    },
  }) as never;

function run(truth: ReadonlyWorldTruth, recent: unknown[], cooldownDays?: number) {
  const proc = councilCasesProcess({
    placeOf: () => ({ kind: "place", id: "place:1" }) as never,
    day: DAY,
    ...(cooldownDays !== undefined ? { cooldownDays } : {}),
  });
  const ctx = { truth, recent, now: 1000, rng: undefined } as never;
  return (
    proc.run as unknown as (c: never) => {
      changes?: unknown[];
      events?: { kind: string; data: never }[];
    }
  )(ctx);
}

function book(out: ReturnType<typeof run>): CaseBook {
  const ch = (out.changes ?? []) as { table?: { name: string }; value?: unknown }[];
  const found = ch.find((c) => JSON.stringify(c).includes("law.cases"));
  const value = (found as { value?: CaseBook } | undefined)?.value;
  if (!value) throw new Error(`sin libro: ${JSON.stringify(out.changes)}`);
  return value;
}

describe("life.council_cases: la denuncia al consejo como Case", () => {
  it("con respeto alto y creencia firme el consejo sanciona, con pena y causa en la denuncia", () => {
    const out = run(world(1), [speak(9, 500, 0.9, "believe")]);
    const b = book(out);
    expect(b.cases).toHaveLength(1);
    const c = b.cases[0];
    expect(c?.response).toBe("sanction");
    expect(c?.status).toBe("decided");
    expect(c?.verdict?.penalty ?? 0).toBeGreaterThan(0);
    expect(c?.originEventId).toBe("event:9");
    expect(c?.judge).toBe(chief);
    const kinds = out.events?.map((e) => e.kind);
    expect(kinds).toEqual(["law.case_opened", "law.case_resolved"]);
    expect(JSON.stringify(out.events?.[0])).toContain("event:9");
    expect(JSON.stringify(out.events?.[1])).toContain("event:~0");
  });

  it("sin respeto el consejo no puede obligar: media; sin creencia, descarta", () => {
    expect(book(run(world(0), [speak(9, 500, 0.9, "believe")])).cases[0]?.response).toBe("mediate");
    expect(book(run(world(1), [speak(9, 500, 0.2, "doubt")])).cases[0]?.status).toBe("dropped");
    expect(book(run(world(1), [speak(9, 500, 0.8, "slander")])).cases[0]?.response).toBe("ignore");
  });

  it("una pena benigna leída por el anciano (hecho disculpable) archiva la sanción", () => {
    const w = world(1);
    w.set(KNOWN_DEEDS, chief, {
      deeds: [
        {
          kind: "theft",
          by: kid,
          victim: dad,
          event: "event:5",
          at: 1,
          via: "told",
          read: { weight: 1 },
        },
      ],
    } as never);
    const b = book(run(w, [speak(9, 500, 0.9, "believe")]));
    expect(b.cases[0]?.status).toBe("dropped");
    expect(b.cases[0]?.facts).toEqual(["event:5"]);
  });

  it("solo un anciano del consejo de la aldea del acusado abre el caso", () => {
    expect(run(world(1), [speak(9, 500, 0.9, "believe", dad)]).events ?? []).toEqual([]);
    expect(run(world(1, false), [speak(9, 500, 0.9, "believe")]).events ?? []).toEqual([]);
  });

  it("la misma denuncia repetida dentro del enfriamiento no abre otro caso", () => {
    const w = world(1);
    const first = book(run(w, [speak(9, 500, 0.9, "believe")]));
    w.set(CASES, org1, first);
    expect(run(w, [speak(10, 600, 0.9, "believe")]).events ?? []).toEqual([]);
    const later = book(run(w, [speak(11, 500 + 31 * DAY, 0.9, "believe")]));
    expect(later.cases).toHaveLength(2);
    expect(later.serial).toBe(2);
  });

  it("es determinista y la pena nunca pasa de la escala ni baja de 0 (propiedad)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (respect, belief) => {
          const a = run(world(respect), [speak(9, 500, belief, "believe")]);
          const b = run(world(respect), [speak(9, 500, belief, "believe")]);
          expect(JSON.stringify(a)).toBe(JSON.stringify(b));
          const c = book(a).cases[0];
          expect(c?.verdict?.penalty ?? 0).toBeGreaterThanOrEqual(0);
          expect(c?.verdict?.penalty ?? 0).toBeLessThanOrEqual(1 + 1e-9);
        },
      ),
      { numRuns: 60 },
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

describe("councilCases en la vida", () => {
  const content = loadContent(GAME_CONTENT_KINDS, sources("content"));

  it("requiere council", () => {
    expect(() => Life.create(3, content, { councilCases: {} })).toThrow(/requiere council/);
  });

  it("apagado deja el hash idéntico al de develop; encendido corre y es determinista", () => {
    const off = Life.create(3, content, {});
    expect(off.hash().total).toBe(
      "b218098c25ac14a61ca65cbd61b1324438ae2a400978faa2e6bfd7efa9b29f26",
    );
    off.advanceTo(off.now + DAY * 5);
    expect(off.hash().total).toBe(
      "29584eac1003de5c7a165b2117001049bfd4294973ef170cd87454713054c9d8",
    );
    const on = () => {
      const l = Life.create(3, content, { council: {}, councilCases: {} });
      l.advanceTo(l.now + DAY * 5);
      return l.hash().total;
    };
    expect(on()).toBe(on());
  });
});
