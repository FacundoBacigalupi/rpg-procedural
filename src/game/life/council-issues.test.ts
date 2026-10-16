import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, loadContent, makeId, Rng } from "../../core/index.ts";
import {
  type Agenda,
  agendaViolations,
  checkInvariants,
  ENTITY,
  HOUSEHOLD,
  ORG_AGENDA,
  type Organization,
  orgViolations,
  PERSON,
  RELATIONS,
  WorldTruth,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { agendaRows, type CouncilOptions, councilProcess, councilRows } from "./council.ts";
import { Life } from "./life.ts";
import { LOANS } from "./loans.ts";

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
const DAY = 86400;

const ag = (n: number) => makeId("agent", n);
const ev = (n: number) => makeId("event", n);
const goods = [{ id: "grain", name: "grano", form: "good" }] as never;
const opts = (over: Partial<CouncilOptions> = {}): CouncilOptions => ({
  day: 10,
  year: 1000,
  placeOf: () => ({ kind: "cell" }) as never,
  goods,
  issues: {},
  ...over,
});

const DIMS = {
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
};
const rel = (dims: Partial<typeof DIMS>, history: unknown[] = []) => ({
  dims: { ...DIMS, ...dims },
  bonds: [],
  history,
  updated: 0,
});

/** Dos hogares: el 1 con los ancianos (1..5) y el 2 con dos vecinos (6, 7). */
function world() {
  const t = new WorldTruth();
  const s = makeId("settlement", 1);
  t.set(ENTITY, s, { id: s, originEventId: ev(1), createdAt: 0 } as never);
  const h1 = makeId("household", 1);
  const h2 = makeId("household", 2);
  const mk = (h: typeof h1, ids: AgentId[], age: number) => {
    t.set(ENTITY, h, { id: h, originEventId: ev(1), createdAt: 0 } as never);
    t.set(HOUSEHOLD, h, { settlement: s, members: ids });
    ids.forEach((id, i) => {
      t.set(ENTITY, id, { id, originEventId: ev(1), createdAt: 0 } as never);
      t.set(PERSON, id, { household: h, born: -(age - i) * 1000 } as never);
    });
  };
  mk(h1, [ag(1), ag(2), ag(3), ag(4), ag(5)], 70);
  mk(h2, [ag(6), ag(7)], 30);
  return { t, h1, h2 };
}

// Ledger de mentira: el hogar 1 con despensa de sobra y el hogar 2 vacío.
const ledger = (full: string) =>
  ({
    balance: (acct: string) => (String(acct).includes(full) ? 900_000 : 0),
  }) as never;

let nid = 0;
function step(truth: WorldTruth, now: number, o: CouncilOptions, led?: unknown, seed = 5) {
  const r = councilProcess(o).run({
    truth,
    now,
    recent: [],
    ledger: led,
    rng: Rng.root(seed as never).fork("test", now),
    newId: () => makeId("org", ++nid),
  } as never);
  for (const c of r.changes ?? []) {
    const x = c as unknown as { table: string; id: never; value: unknown };
    truth.setRaw(x.table, x.id, x.value);
  }
  return r;
}

const defaulted = (borrower: string, lender: string) =>
  ({
    status: "defaulted",
    borrower,
    lender,
    principal: 100,
    rate: 0.2,
    paid: 20,
    seed: "s",
  }) as never;

const off = (() => {
  const { issues: _i, ...rest } = opts();
  return rest as CouncilOptions;
})();

describe("life.council: asuntos y deliberación (proceso aislado)", () => {
  it("una deuda caída en mora la plantea quien la percibe y se vota al día siguiente, con causas", () => {
    const { t, h1, h2 } = world();
    step(t, 0, opts()); // funda
    const loan = makeId("commitment", 1);
    t.set(LOANS, loan, defaulted(h2, h1));
    // el anciano 3 es cercano al deudor 6
    t.set(RELATIONS, ag(3), {
      toward: { [ag(6)]: rel({ affection: 0.8, familiarity: 0.9 }) },
      originEventId: ev(1),
    } as never);
    const r1 = step(t, 5, opts());
    const raised = r1.events?.find((e) => e.kind === "org.issue_raised");
    expect(raised?.data).toMatchObject({ kind: "debt", subject: loan, raisedBy: ag(3) });
    expect(raised?.causes.length).toBeGreaterThan(0);
    const agenda = agendaRows(t)[0]?.agenda as Agenda;
    expect(agenda.open).toHaveLength(1);
    // antes del plazo de deliberación no se vota
    expect(step(t, 8, opts()).events?.some((e) => e.kind === "org.decided")).toBeFalsy();
    const r2 = step(t, 20, opts());
    const dec = r2.events?.find((e) => e.kind === "org.decided");
    expect(dec).toBeDefined();
    expect(dec?.causes.some((c) => c.kind === "event")).toBe(true);
    const after = agendaRows(t)[0]?.agenda as Agenda;
    expect(after.open).toHaveLength(0);
    expect(after.decisions[0]?.votes.length).toBe(5);
    const org = councilRows(t)[0]?.org as Organization;
    expect(agendaViolations(org, after)).toEqual([]);
    expect(orgViolations(org)).toEqual([]);
    // enfriamiento: no se vuelve a plantear enseguida
    expect(step(t, 25, opts()).events?.some((e) => e.kind === "org.issue_raised")).toBeFalsy();
  });

  it("la hambruna de un hogar ajeno que nadie percibe no llega al consejo", () => {
    const { t, h1 } = world();
    step(t, 0, opts());
    const r = step(t, 5, opts(), ledger(h1));
    expect(r.events?.some((e) => e.kind === "org.issue_raised")).toBeFalsy();
  });

  it("la hambruna se plantea cuando alguien del consejo la ve (su hogar o un vecino querido)", () => {
    const { t, h1 } = world();
    step(t, 0, opts());
    t.set(RELATIONS, ag(2), {
      toward: { [ag(6)]: rel({ affection: 0.7, familiarity: 0.8 }) },
      originEventId: ev(1),
    } as never);
    const r = step(t, 5, opts(), ledger(h1));
    const raised = r.events?.find((e) => e.kind === "org.issue_raised");
    expect(raised?.data).toMatchObject({ kind: "famine", raisedBy: ag(2) });
    expect(JSON.stringify(raised?.causes)).toContain("pantry_days");
  });

  it("la disputa con rencor entre vecinos es asunto; si la presión se va, el asunto caduca", () => {
    const { t } = world();
    step(t, 0, opts());
    t.set(RELATIONS, ag(6), {
      toward: { [ag(7)]: rel({ resentment: 0.9 }, [ev(7)]) },
      originEventId: ev(1),
    } as never);
    t.set(RELATIONS, ag(4), {
      toward: { [ag(6)]: rel({ affection: 0.6, familiarity: 0.9 }) },
      originEventId: ev(1),
    } as never);
    const r1 = step(t, 5, opts());
    const raised = r1.events?.find((e) => e.kind === "org.issue_raised");
    expect(raised?.data).toMatchObject({ kind: "dispute", raisedBy: ag(4) });
    expect(JSON.stringify(raised?.causes)).toContain(ev(7));
    t.set(RELATIONS, ag(6), {
      toward: { [ag(7)]: rel({ resentment: 0 }) },
      originEventId: ev(1),
    } as never);
    const r2 = step(t, 20, opts());
    expect(r2.events?.some((e) => e.kind === "org.issue_lapsed")).toBe(true);
    const org = councilRows(t)[0]?.org as Organization;
    expect(agendaViolations(org, agendaRows(t)[0]?.agenda as Agenda)).toEqual([]);
  });

  it("sin la opción `issues` no hay agenda ni eventos de asuntos", () => {
    const { t, h2, h1 } = world();
    step(t, 0, off);
    t.set(LOANS, makeId("commitment", 1), defaulted(h2, h1));
    const r = step(t, 5, off);
    expect(r.events ?? []).toEqual([]);
    expect(t.ids(ORG_AGENDA)).toHaveLength(0);
  });

  it("propiedad: con presiones y relaciones al azar, la agenda cumple las reglas y es reproducible", () => {
    const rels = fc.array(
      fc.record({
        a: fc.integer({ min: 1, max: 7 }),
        b: fc.integer({ min: 1, max: 7 }),
        affection: fc.double({ min: 0, max: 1, noNaN: true }),
        familiarity: fc.double({ min: 0, max: 1, noNaN: true }),
        resentment: fc.double({ min: 0, max: 1, noNaN: true }),
        trust: fc.double({ min: -1, max: 1, noNaN: true }),
      }),
      { maxLength: 14 },
    );
    fc.assert(
      fc.property(rels, fc.boolean(), fc.integer({ min: 1, max: 1e5 }), (rs, loan, seed) => {
        const run = () => {
          nid = 0;
          const { t, h1, h2 } = world();
          step(t, 0, opts(), undefined, seed);
          const by = new Map<number, Record<string, unknown>>();
          for (const r of rs)
            if (r.a !== r.b)
              by.set(r.a, {
                ...(by.get(r.a) ?? {}),
                [ag(r.b)]: rel({
                  affection: r.affection,
                  familiarity: r.familiarity,
                  resentment: r.resentment,
                  trust: r.trust,
                }),
              });
          for (const [a, toward] of by)
            t.set(RELATIONS, ag(a), { toward, originEventId: ev(1) } as never);
          if (loan) t.set(LOANS, makeId("commitment", 1), defaulted(h2, h1));
          for (const day of [5, 20, 40, 80]) step(t, day, opts(), ledger(h1), seed);
          const org = councilRows(t)[0]?.org as Organization;
          const agenda = (agendaRows(t)[0]?.agenda ?? {
            open: [],
            decisions: [],
            serial: 0,
          }) as Agenda;
          expect(agendaViolations(org, agenda)).toEqual([]);
          expect(orgViolations(org)).toEqual([]);
          return JSON.stringify(agenda);
        };
        expect(run()).toBe(run());
      }),
      { numRuns: 40 },
    );
  });
});

describe("life.council: asuntos en la vida", () => {
  const lifeWith = (issues: boolean) => {
    const life = Life.create(
      3,
      content,
      issues ? { council: { issues: { famineDays: 100000 } } } : { council: {} },
    );
    life.advanceTo(life.now + DAY * 20);
    return life;
  };

  it("encendido es determinista, deja eventos con causa y cumple los invariantes", () => {
    const a = lifeWith(true);
    expect(a.hash().total).toBe(lifeWith(true).hash().total);
    const { truth, log } = a.world;
    for (const { org } of councilRows(truth))
      for (const r of agendaRows(truth)) {
        expect(agendaViolations(org, r.agenda)).toEqual([]);
      }
    for (const e of log
      .all()
      .filter((x) => x.kind === "org.issue_raised" || x.kind === "org.decided"))
      expect(e.causes.length).toBeGreaterThan(0);
    // con el umbral de hambre altísimo toda despensa cuenta como escasa: hay asuntos y votaciones reales
    const raised = log.all().filter((x) => x.kind === "org.issue_raised");
    const decided = log.all().filter((x) => x.kind === "org.decided");
    expect(raised.length).toBeGreaterThan(0);
    expect(decided.length).toBeGreaterThan(0);
    for (const d of decided) {
      const issue = (d.data as { issue: string }).issue;
      expect(raised.some((r) => (r.data as { issue: string }).issue === issue)).toBe(true);
      expect(
        d.causes.some((c) => c.kind === "event" && log.get(c.event)?.kind === "org.issue_raised"),
      ).toBe(true);
    }
    expect(checkInvariants({ truth, log })).toEqual([]);
  });

  it("con `council` sin `issues` el mundo no cambia respecto de antes (sin agenda ni eventos)", () => {
    const life = lifeWith(false);
    expect(life.world.truth.ids(ORG_AGENDA)).toHaveLength(0);
    expect(
      life.world.log.all().some((e) => ["org.issue_raised", "org.decided"].includes(e.kind)),
    ).toBe(false);
  });

  it("apagado: los hashes de siempre", () => {
    const life = Life.create(3, content, { legacyNoOscillationEvents: true });
    expect(life.hash().total).toBe(
      "b829bb7436cffc764da33660c899d578132ea796fdf7f86e47af651e5310c12f",
    );
    life.advanceTo(life.now + DAY * 5);
    expect(life.hash().total).toBe(
      "ab02c781a70744adc3f00ff20234fd2ffd8bf4beb97b513920806ab288f418ab",
    );
  });
});
