import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  type EventId,
  type HolderRef,
  holderAccount,
  Ledger,
  loadContent,
  type OrgId,
  type SettlementId,
} from "../../core/index.ts";
import {
  compensationDue,
  ENTITY,
  foundCouncil,
  goodUnit,
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
const sett = "settlement:1" as SettlementId;
const org1 = "org:1" as OrgId;
const kid = "agent:1" as AgentId; // el acusado
const dad = "agent:2" as AgentId; // quien acusa
const chief = "agent:3" as AgentId;
const elder = "agent:4" as AgentId;
const homeOf = {
  [kid]: "household:1",
  [dad]: "household:2",
  [chief]: "household:3",
  [elder]: "household:3",
};
const DAY = 86400;
const GRAIN = goodUnit({ id: "grain", form: "good" });
const goods = [{ id: "grain", name: "grano", form: "good" }] as never;
const acct = (h: string) => holderAccount(h as unknown as HolderRef);
const dims = (o: Record<string, number>) =>
  ({
    trust: 0,
    respect: 0,
    affection: 0,
    fear: 0,
    attraction: 0,
    gratitude: 0,
    jealousy: 0,
    resentment: 0,
    familiarity: 0,
    dependency: 0,
    ...o,
  }) as never;
const rel = (o: Record<string, number>) => ({ dims: dims(o), bonds: [], history: [], updated: 0 });

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
      household: homeOf[id],
      spouse: null,
    } as never);
  }
  for (const h of ["household:1", "household:2", "household:3"])
    w.set(
      HOUSEHOLD,
      h as never,
      {
        settlement: sett,
        members: Object.entries(homeOf)
          .filter(([, v]) => v === h)
          .map(([k]) => k),
      } as never,
    );
  w.set(RELATIONS, kid, {
    originEventId: ev,
    toward: {
      [chief]: rel({ respect }),
      [elder]: rel({ respect }),
      [dad]: rel({ resentment: 0.2 }),
    },
  });
  w.set(RELATIONS, dad, { originEventId: ev, toward: { [kid]: rel({ resentment: 0.5 }) } });
  w.set(RELATIONS, chief, { originEventId: ev, toward: { [kid]: rel({ respect: 0.5 }) } });
  w.set(RELATIONS, elder, { originEventId: ev, toward: { [kid]: rel({ respect: -0.95 }) } });
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

function ledgerWith(grams: number): Ledger {
  const l = new Ledger({ externals: { mint: [GRAIN] } });
  if (grams > 0)
    l.post({
      tick: 0,
      eventId: ev,
      transfers: [
        { from: "ext:mint" as never, to: acct("household:1"), unit: GRAIN, amount: grams },
      ],
    });
  return l;
}

const speak = (id: number, belief: number) =>
  ({
    id: `event:${id}`,
    tick: 500,
    kind: "action.speak",
    actors: [chief, dad],
    data: {
      effect: {
        accusation: { accused: kid, deed: "theft", unbacked: false, verdict: "believe", belief },
      },
    },
  }) as never;

interface EffData {
  compensation?: { amount: number };
  resentment?: number;
  face?: number;
  status?: string;
}
interface Dims {
  resentment?: number;
  respect?: number;
}
type Out = {
  changes?: { table: string; id: string; value: unknown }[];
  events?: { kind: string; data: EffData; causes: unknown[] }[];
  postings?: {
    event: unknown;
    transfers: { from: string; to: string; unit: string; amount: number }[];
  }[];
};

function run(truth: ReadonlyWorldTruth, ledger: Ledger, belief = 0.9, effects?: object): Out {
  const proc = councilCasesProcess({
    placeOf: () => ({ kind: "place", id: "place:1" }) as never,
    day: DAY,
    goods,
    ...(effects ? { effects } : {}),
  });
  return (proc.run as unknown as (c: never) => Out)({
    truth,
    recent: [speak(9, belief)],
    now: 1000,
    ledger,
    rng: undefined,
  } as never);
}

const relOf = (out: Out, who: string) =>
  out.changes?.find((c) => c.table === RELATIONS.name && c.id === who)?.value as
    | { toward: Record<string, { dims: Dims }> }
    | undefined;

function apply(out: Out, ledger: Ledger): void {
  for (const p of out.postings ?? [])
    ledger.post({ tick: 1000, eventId: "event:77" as EventId, transfers: p.transfers as never });
}

describe("law.case_effects: la sanción y la mediación mueven el mundo", () => {
  it("la sanción paga del hogar del acusado al del acusador por el ledger, sube el rencor y baja la cara", () => {
    const ledger = ledgerWith(100000);
    const out = run(world(1), ledger, 0.9, {});
    const e = out.events?.find((x) => x.kind === "law.case_effects");
    expect(e).toBeDefined();
    const amount = e?.data.compensation?.amount ?? 0;
    expect(amount).toBeGreaterThan(0);
    expect(out.postings).toHaveLength(1);
    expect(out.postings?.[0]?.transfers).toEqual([
      { from: acct("household:1"), to: acct("household:2"), unit: GRAIN, amount },
    ]);
    // causa: la resolución, y el posting cuelga del evento de efectos
    expect(JSON.stringify(e?.causes)).toContain("event:~1");
    expect(JSON.stringify(out.postings?.[0]?.event)).toContain("event:~2");
    apply(out, ledger);
    expect(ledger.audit()).toEqual([]);
    expect(ledger.balance(acct("household:1"), GRAIN)).toBe(100000 - amount);
    expect(ledger.balance(acct("household:2"), GRAIN)).toBe(amount);
    // rencor del acusado hacia el acusador sube; el respeto del consejo al acusado baja (el anciano ya en -0.95 se acota)
    expect(relOf(out, kid)?.toward[dad]?.dims.resentment ?? 0).toBeGreaterThan(0.2);
    expect(relOf(out, chief)?.toward[kid]?.dims.respect ?? 1).toBeLessThan(0.5);
    expect(relOf(out, elder)?.toward[kid]?.dims.respect ?? 0).toBeGreaterThanOrEqual(-1);
  });

  it("solo paga lo que el hogar tiene: sin grano no hay compensación pero sí cara", () => {
    const out = run(world(1), ledgerWith(0), 0.9, {});
    expect(out.postings ?? []).toEqual([]);
    const e = out.events?.find((x) => x.kind === "law.case_effects");
    expect(e?.data.compensation).toBeUndefined();
    expect(e?.data.face).toBeLessThan(0);
    const some = run(world(1), ledgerWith(300), 0.9, {});
    expect(some.postings?.[0]?.transfers[0]?.amount).toBeLessThanOrEqual(300);
  });

  it("la mediación baja el rencor de las dos partes y no mueve grano", () => {
    const out = run(world(0), ledgerWith(100000), 0.9, {});
    const e = out.events?.find((x) => x.kind === "law.case_effects");
    expect(e?.data.status).toBe("settled");
    expect(out.postings ?? []).toEqual([]);
    expect(relOf(out, kid)?.toward[dad]?.dims.resentment).toBeCloseTo(0.1, 5);
    expect(relOf(out, dad)?.toward[kid]?.dims.resentment).toBeCloseTo(0.4, 5);
  });

  it("sin effects no hay efectos ni postings; descartar no mueve nada", () => {
    const off = run(world(1), ledgerWith(100000), 0.9);
    expect(off.events?.map((x) => x.kind)).toEqual(["law.case_opened", "law.case_resolved"]);
    expect(off.postings).toBeUndefined();
    expect(off.changes?.some((c) => c.table === RELATIONS.name)).toBe(false);
    const dropped = run(world(1), ledgerWith(100000), 0.1, {});
    expect(dropped.events?.some((x) => x.kind === "law.case_effects")).toBe(false);
  });

  it("propiedad: determinista, el ledger audita limpio, nunca paga de más y las dimensiones quedan acotadas", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.integer({ min: 0, max: 60000 }),
        (respect, belief, grams) => {
          const la = ledgerWith(grams);
          const a = run(world(respect), la, belief, {});
          const b = run(world(respect), ledgerWith(grams), belief, {});
          expect(JSON.stringify(a)).toBe(JSON.stringify(b));
          apply(a, la);
          expect(la.audit()).toEqual([]);
          expect(la.balance(acct("household:1"), GRAIN)).toBeGreaterThanOrEqual(0);
          expect(
            la.balance(acct("household:1"), GRAIN) + la.balance(acct("household:2"), GRAIN),
          ).toBe(grams);
          for (const c of a.changes ?? [])
            if (c.table === RELATIONS.name)
              for (const t of Object.values(
                (c.value as { toward: Record<string, { dims: Dims }> }).toward,
              )) {
                expect(t.dims.resentment ?? 0).toBeGreaterThanOrEqual(0);
                expect(t.dims.resentment ?? 0).toBeLessThanOrEqual(1);
                expect(t.dims.respect ?? 0).toBeGreaterThanOrEqual(-1);
              }
        },
      ),
      { numRuns: 60 },
    );
  });

  it("compensationDue es monótona, acotada por el saldo y por la multa", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1, max: 2, noNaN: true }),
        fc.integer({ min: 0, max: 100000 }),
        fc.integer({ min: 0, max: 100000 }),
        (p, fine, bal) => {
          const d = compensationDue(p, fine, bal);
          expect(d).toBeGreaterThanOrEqual(0);
          expect(d).toBeLessThanOrEqual(bal);
          expect(d).toBeLessThanOrEqual(fine);
        },
      ),
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

describe("councilCases.effects en la vida", () => {
  const content = loadContent(GAME_CONTENT_KINDS, sources("content"));

  it("apagado conserva el hash; encendido es determinista", () => {
    expect(Life.create(3, content, {}).hash().total).toBe(
      "b218098c25ac14a61ca65cbd61b1324438ae2a400978faa2e6bfd7efa9b29f26",
    );
    const on = () => {
      const l = Life.create(3, content, { council: {}, councilCases: { effects: {} } });
      l.advanceTo(l.now + DAY * 5);
      return l.hash().total;
    };
    expect(on()).toBe(on());
  });
});
