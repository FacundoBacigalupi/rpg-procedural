import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  type HolderRef,
  holderAccount,
  Ledger,
  loadContent,
  makeId,
  Rng,
} from "../../core/index.ts";
import {
  checkInvariants,
  DEFAULT_LOYALTY_RULES,
  ENTITY,
  goodUnit,
  HOUSEHOLD,
  loyaltyOf,
  loyaltyViolations,
  ORG_LOYALTY,
  ORG_ORDERS,
  type OrderBook,
  orderViolations,
  PERSON,
  RELATIONS,
  WorldTruth,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { type CouncilOptions, councilProcess, councilRows } from "./council.ts";
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
const GRAIN = goodUnit({ id: "grain", form: "good" });
const acct = (h: string) => holderAccount(h as unknown as HolderRef);

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

const opts = (over: Partial<CouncilOptions> = {}): CouncilOptions => ({
  day: 10,
  year: 1000,
  placeOf: () => ({ kind: "cell" }) as never,
  goods,
  issues: {},
  treasury: { orders: {}, contribute: [{ good: "grain", amount: 10000, keep: 0 }], everyDays: 1 },
  ...over,
});

/** Aldea de dos hogares: 1 con los ancianos (1..5, con grano) y 2 con dos vecinos (6, 7, sin nada). */
function setup() {
  const t = new WorldTruth();
  const ledger = new Ledger({ externals: { mint: [GRAIN] } });
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
  ledger.post({
    tick: 0,
    eventId: ev(1),
    transfers: [{ from: "ext:mint" as never, to: acct(h1), unit: GRAIN, amount: 900_000 }],
  });
  return { t, ledger, h1, h2 };
}

let nid = 0;
let evn = 100;
function step(
  w: ReturnType<typeof setup>,
  now: number,
  o: CouncilOptions,
  seed = 5,
): {
  kinds: string[];
  events: { kind: string; data: Record<string, unknown>; causes: unknown[] }[];
} {
  const r = councilProcess(o).run({
    truth: w.t,
    now,
    recent: [],
    ledger: w.ledger,
    rng: Rng.root(seed as never).fork("test", now),
    newId: () => makeId("org", ++nid),
  } as never);
  for (const c of r.changes ?? []) {
    const x = c as unknown as { table: string; id: never; value: unknown };
    w.t.setRaw(x.table, x.id, x.value);
  }
  for (const p of r.postings ?? [])
    w.ledger.post({ tick: now, eventId: ev(++evn), transfers: p.transfers });
  const events = (r.events ?? []) as never as {
    kind: string;
    data: Record<string, unknown>;
    causes: unknown[];
  }[];
  return { kinds: events.map((e) => e.kind), events };
}

const book = (w: ReturnType<typeof setup>): OrderBook =>
  (w.t.get(ORG_ORDERS, "org:1" as never) ?? { orders: [], assumed: {}, serial: 0 }) as OrderBook;
const vault = () => acct("org:1");
const DAYS = Array.from({ length: 31 }, (_, i) => i * 10);

/** Corre los días hasta que haya un evento de `kind`; devuelve el seed con que ocurrió. */
function until(
  prep: (w: ReturnType<typeof setup>) => void,
  kind: string,
  o = opts(),
  option?: string,
) {
  for (let seed = 1; seed <= 80; seed++) {
    nid = 0;
    const w = setup();
    step(w, 0, o, seed);
    prep(w);
    const all: ReturnType<typeof step>["events"] = [];
    for (const d of DAYS.slice(1)) all.push(...step(w, d, o, seed).events);
    if (all.some((e) => e.kind === kind && (!option || e.data["option"] === option)))
      return { w, seed, events: all };
  }
  throw new Error(`nunca hubo ${kind}`);
}

const seedFamine = (w: ReturnType<typeof setup>) =>
  w.t.set(RELATIONS, ag(2), {
    toward: { [ag(6)]: rel({ affection: 0.7, familiarity: 0.8 }) },
    originEventId: ev(1),
  } as never);

describe("life.council: tesoro y órdenes (proceso aislado)", () => {
  it("los miembros aportan de su hogar y el tesoro es lo aportado, con causa", () => {
    nid = 0;
    const w = setup();
    const { issues: _i, ...base } = opts();
    const o: CouncilOptions = {
      ...base,
      treasury: { contribute: [{ good: "grain", amount: 10000, keep: 0 }], everyDays: 5 },
    };
    step(w, 0, o);
    const before = w.ledger.balance(acct(w.h1), GRAIN);
    const r = step(w, 50, o); // día 5: aportan
    const gifts = r.events.filter((e) => e.kind === "org.contributed");
    expect(gifts).toHaveLength(5);
    for (const g of gifts) expect(g.causes.length).toBeGreaterThan(0);
    expect(w.ledger.balance(vault(), GRAIN)).toBe(50_000);
    expect(w.ledger.balance(acct(w.h1), GRAIN)).toBe(before - 50_000);
    expect(w.ledger.audit()).toEqual([]);
  });

  it("nadie aporta lo que no le sobra (keep) y sin ledger no pasa nada", () => {
    nid = 0;
    const w = setup();
    const o = opts({
      treasury: { contribute: [{ good: "grain", amount: 10000, keep: 900_000 }], everyDays: 5 },
    });
    step(w, 0, o);
    expect(step(w, 50, o).events.some((e) => e.kind === "org.contributed")).toBe(false);
    expect(w.ledger.balance(vault(), GRAIN)).toBe(0);
  });

  it("la hambruna decidida se reparte del tesoro al hogar, por un miembro, con costo y causa", () => {
    const { w, events } = until(seedFamine, "org.order_executed", opts(), "relief");
    const done = events.find(
      (e) => e.kind === "org.order_executed" && e.data["option"] === "relief",
    );
    expect(done?.data).toMatchObject({ option: "relief", subject: "household:2" });
    expect(done?.causes.length).toBeGreaterThan(0);
    const spent = done?.data["spent"] as number;
    expect(spent).toBeGreaterThan(0);
    const total = events
      .filter((e) => e.kind === "org.order_executed" && e.data["subject"] === "household:2")
      .reduce((n, e) => n + (e.data["spent"] as number), 0);
    expect(w.ledger.balance(acct("household:2"), GRAIN)).toBe(total);
    const given = events.filter((e) => e.kind === "org.contributed").length * 10000;
    const allSpent = events
      .filter((e) => e.kind === "org.order_executed")
      .reduce((n, e) => n + (e.data["spent"] as number), 0);
    expect(w.ledger.balance(vault(), GRAIN)).toBe(given - allSpent);
    expect(w.ledger.audit()).toEqual([]);
    const org = councilRows(w.t)[0]?.org;
    if (org) expect(orderViolations(org, book(w))).toEqual([]);
    expect(book(w).orders.some((x) => x.status === "done" && x.spent === spent)).toBe(true);
  });

  it("la orden queda sin cumplir si el ejecutor desobedece, y el tesoro no se toca", () => {
    const o = opts({
      treasury: { ...opts().treasury, orders: { assentObeys: 0, dissentObeys: 0 } },
    });
    const { w, events } = until(seedFamine, "org.order_refused", o);
    expect(events.some((e) => e.kind === "org.order_executed")).toBe(false);
    expect(w.ledger.balance(acct("household:2"), GRAIN)).toBe(0);
    const given = events.filter((e) => e.kind === "org.contributed").length * 10000;
    expect(w.ledger.balance(vault(), GRAIN)).toBe(given);
    expect(book(w).orders.some((x) => x.status === "refused")).toBe(true);
  });

  it("con el tesoro vacío la orden falla con causa", () => {
    const o = opts({ treasury: { orders: {}, contribute: [], everyDays: 5 } });
    const { events } = until(seedFamine, "org.order_failed", o);
    const f = events.find((e) => e.kind === "org.order_failed");
    expect(f?.data["note"]).toBe("empty_treasury");
    expect(f?.causes.length).toBeGreaterThan(0);
  });

  it("la deuda en mora se asume en parte desde el tesoro y paga al acreedor", () => {
    const loan = makeId("commitment", 1);
    const prep = (w: ReturnType<typeof setup>) => {
      w.t.set(LOANS, loan, {
        status: "defaulted",
        borrower: w.h2,
        lender: w.h1,
        lenderAccount: acct(w.h1),
        borrowerAccount: acct(w.h2),
        unit: GRAIN,
        principal: 100,
        rate: 0.2,
        paid: 20,
        seed: "s",
      } as never);
      w.t.set(RELATIONS, ag(3), {
        toward: { [ag(6)]: rel({ affection: 0.8, familiarity: 0.9 }) },
        originEventId: ev(1),
      } as never);
    };
    // El acreedor es el hogar de los ancianos: el que tiene que cumplir tiene conflicto; se busca un seed que obedezca.
    const o = opts({ treasury: { ...opts().treasury, orders: { conflictPenalty: 0 } } });
    const { w, events } = until(prep, "org.order_executed", o, "extend");
    const done = events.find(
      (e) => e.kind === "org.order_executed" && e.data["option"] === "extend",
    );
    expect(done?.data).toMatchObject({ option: "extend", subject: loan });
    const paid = done?.data["spent"] as number;
    expect(paid).toBe(50); // la mitad de lo que faltaba (100 + 20 de interés - 20 pagados = 100)
    expect(book(w).assumed[loan]).toBe(paid);
    expect(w.ledger.audit()).toEqual([]);
  });

  it("la mediación baja el rencor de las dos partes y paga la comida del tesoro", () => {
    const prep = (w: ReturnType<typeof setup>) => {
      w.t.set(RELATIONS, ag(6), {
        toward: { [ag(7)]: rel({ resentment: 0.9 }, [ev(7)]) },
        originEventId: ev(1),
      } as never);
      w.t.set(RELATIONS, ag(7), {
        toward: { [ag(6)]: rel({ resentment: 0.6 }) },
        originEventId: ev(1),
      } as never);
      w.t.set(RELATIONS, ag(4), {
        toward: { [ag(6)]: rel({ affection: 0.6, familiarity: 0.9 }) },
        originEventId: ev(1),
      } as never);
    };
    const { w, events } = until(prep, "org.order_executed", opts(), "mediate");
    const done = events.find(
      (e) => e.kind === "org.order_executed" && e.data["option"] === "mediate",
    );
    expect(done?.data).toMatchObject({ option: "mediate" });
    expect(w.t.get(RELATIONS, ag(6))?.toward[ag(7)]?.dims.resentment).toBeCloseTo(0.6, 5);
    expect(w.t.get(RELATIONS, ag(7))?.toward[ag(6)]?.dims.resentment).toBeCloseTo(0.3, 5);
    expect(done?.data["spent"] as number).toBeGreaterThan(0);
    expect(w.ledger.audit()).toEqual([]);
  });

  it("propiedad: con relaciones y semillas al azar el libro cumple las reglas, el ledger audita limpio y es reproducible", () => {
    const rels = fc.array(
      fc.record({
        a: fc.integer({ min: 1, max: 7 }),
        b: fc.integer({ min: 1, max: 7 }),
        affection: fc.double({ min: 0, max: 1, noNaN: true }),
        familiarity: fc.double({ min: 0, max: 1, noNaN: true }),
        resentment: fc.double({ min: 0, max: 1, noNaN: true }),
      }),
      { maxLength: 12 },
    );
    fc.assert(
      fc.property(rels, fc.integer({ min: 1, max: 1e5 }), (rs, seed) => {
        const run = () => {
          nid = 0;
          const w = setup();
          step(w, 0, opts(), seed);
          const by = new Map<number, Record<string, unknown>>();
          for (const r of rs)
            if (r.a !== r.b)
              by.set(r.a, {
                ...(by.get(r.a) ?? {}),
                [ag(r.b)]: rel({
                  affection: r.affection,
                  familiarity: r.familiarity,
                  resentment: r.resentment,
                }),
              });
          for (const [a, toward] of by)
            w.t.set(RELATIONS, ag(a), { toward, originEventId: ev(1) } as never);
          for (const d of [...DAYS.slice(1), 600, 800]) step(w, d, opts(), seed);
          expect(w.ledger.audit()).toEqual([]);
          const org = councilRows(w.t)[0]?.org;
          if (org) expect(orderViolations(org, book(w))).toEqual([]);
          return JSON.stringify([book(w), w.ledger.balance(vault(), GRAIN)]);
        };
        expect(run()).toBe(run());
      }),
      { numRuns: 25 },
    );
  });
});

describe("life.council: tesoro y órdenes en la vida", () => {
  const lifeWith = (treasury: boolean) => {
    const life = Life.create(3, content, {
      council: {
        issues: { famineDays: 100000 },
        ...(treasury
          ? {
              treasury: {
                everyDays: 5,
                contribute: [{ good: "grain", amount: 2000, keep: 0 }],
                orders: {},
              },
            }
          : {}),
      },
    });
    life.advanceTo(life.now + DAY * 60);
    return life;
  };

  it("encendido es determinista, el ledger audita limpio y todo tiene causa", () => {
    const a = lifeWith(true);
    expect(a.hash().total).toBe(lifeWith(true).hash().total);
    const { truth, log, ledger } = a.world;
    expect(ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth, log })).toEqual([]);
    const kinds = new Set(log.all().map((e) => e.kind));
    expect(kinds.has("org.contributed")).toBe(true);
    expect(kinds.has("org.ordered")).toBe(true);
    for (const e of log
      .all()
      .filter((x) => x.kind.startsWith("org.order") || x.kind === "org.contributed"))
      expect(e.causes.length).toBeGreaterThan(0);
    for (const id of truth.ids(ORG_ORDERS)) {
      const org = councilRows(truth).find((r) => r.id === (id as string))?.org;
      const b = truth.get(ORG_ORDERS, id) as OrderBook;
      if (org) expect(orderViolations(org, b)).toEqual([]);
    }
    // Conservación: lo que hay en el tesoro es lo aportado menos lo gastado en órdenes.
    const gifted = log
      .all()
      .filter((e) => e.kind === "org.contributed")
      .reduce((n, e) => n + (e.data as { amount: number }).amount, 0);
    const spent = log
      .all()
      .filter((e) => e.kind === "org.order_executed")
      .reduce((n, e) => n + ((e.data as { spent?: number }).spent ?? 0), 0);
    let held = 0;
    for (const { id } of councilRows(truth))
      held += ledger.balance(holderAccount(id as unknown as HolderRef), GRAIN);
    expect(held).toBe(gifted - spent);
  });

  it("sin `treasury` no hay aportes, libro ni órdenes", () => {
    const life = lifeWith(false);
    expect(life.world.truth.ids(ORG_ORDERS)).toHaveLength(0);
    expect(
      life.world.log
        .all()
        .some((e) => e.kind === "org.contributed" || e.kind.startsWith("org.order")),
    ).toBe(false);
  });

  it("apagado: los hashes de siempre", () => {
    const life = Life.create(3, content, {
      legacyNoOscillationEvents: true,
      legacyNoToldBeliefs: true,
      legacyHeardReaders: true,
      legacyHeardTable: true,
    });
    expect(life.hash().total).toBe(
      "2c318d12dc9cb3885ed31505c89946a44164619809d8e0cb538b64ca6909f206",
    );
    life.advanceTo(life.now + DAY * 5);
    expect(life.hash().total).toBe(
      "72b116bae6593c310f3f53a8b85c5dd51457a49fd8a8232c4c24a5d7b00db0d6",
    );
  });
});

describe("life.council: lealtad a la organización (5b)", () => {
  const withLoyalty = (rules = {}) => opts({ treasury: { ...opts().treasury, loyalty: rules } });
  const loyalty = (w: ReturnType<typeof setup>) => w.t.get(ORG_LOYALTY, "org:1" as never);
  const preset = (w: ReturnType<typeof setup>, v: number) =>
    w.t.set(ORG_LOYALTY, "org:1" as never, {
      toward: Object.fromEntries(
        [ag(6), ag(7)].map((a) => [a, { value: v, updated: 0, cause: ev(1), moves: 1 }]),
      ),
    });

  it("la orden cumplida sube la lealtad de quien recibe, no la de los demás", () => {
    const { w } = until(seedFamine, "org.order_executed", withLoyalty(), "relief");
    const l = loyalty(w);
    expect(loyaltyOf(l, ag(6))).toBeGreaterThan(0);
    expect(loyaltyOf(l, ag(7))).toBeGreaterThan(0);
    expect(l?.toward[ag(6)]?.cause).toBeTruthy();
    expect(Object.keys(l?.toward ?? {}).every((k) => w.t.get(PERSON, k as AgentId))).toBe(true);
    const org = councilRows(w.t)[0]?.org;
    if (org && l) expect(loyaltyViolations(org, l)).toEqual([]);
  });

  it("la orden desobedecida baja la lealtad de quien esperaba el socorro", () => {
    const o = opts({
      treasury: {
        ...opts().treasury,
        orders: { assentObeys: 0, dissentObeys: 0 },
        loyalty: {},
      },
    });
    const { w } = until(
      (x) => {
        seedFamine(x);
        preset(x, 0.5);
      },
      "org.order_refused",
      o,
    );
    expect(loyaltyOf(loyalty(w), ag(6))).toBeLessThan(0.5);
    expect(loyaltyOf(loyalty(w), ag(6))).toBeGreaterThanOrEqual(0);
  });

  it("con el tesoro vacío la orden falla y la lealtad baja menos que con una desobediencia", () => {
    const failed = opts({ treasury: { orders: {}, contribute: [], everyDays: 5, loyalty: {} } });
    const { w } = until(
      (x) => {
        seedFamine(x);
        preset(x, 0.5);
      },
      "org.order_failed",
      failed,
    );
    expect(loyaltyOf(loyalty(w), ag(7))).toBeCloseTo(0.5 - DEFAULT_LOYALTY_RULES.failedLoss, 5);
    expect(DEFAULT_LOYALTY_RULES.failedLoss).toBeLessThan(DEFAULT_LOYALTY_RULES.refusedLoss);
  });

  it("sin `loyalty` no hay tabla de lealtad", () => {
    const { w } = until(seedFamine, "org.order_executed", opts(), "relief");
    expect(loyalty(w)).toBeUndefined();
  });

  it("propiedad: la lealtad queda en 0-1, con causa, y es reproducible", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1e5 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (seed, start) => {
          const run = () => {
            nid = 0;
            const w = setup();
            const o = withLoyalty();
            step(w, 0, o, seed);
            seedFamine(w);
            preset(w, start);
            for (const d of [...DAYS.slice(1), 600, 800]) step(w, d, o, seed);
            const l = loyalty(w);
            const org = councilRows(w.t)[0]?.org;
            if (org && l) expect(loyaltyViolations(org, l)).toEqual([]);
            return JSON.stringify(l);
          };
          expect(run()).toBe(run());
        },
      ),
      { numRuns: 15 },
    );
  });

  it("en la vida: determinista, invariantes limpios y la tabla cumple las reglas", () => {
    const make = () => {
      const life = Life.create(3, content, {
        council: {
          issues: { famineDays: 100000 },
          treasury: {
            everyDays: 5,
            contribute: [{ good: "grain", amount: 2000, keep: 0 }],
            orders: {},
            loyalty: {},
          },
        },
      });
      life.advanceTo(life.now + DAY * 60);
      return life;
    };
    const a = make();
    expect(a.hash().total).toBe(make().hash().total);
    expect(checkInvariants({ truth: a.world.truth, log: a.world.log })).toEqual([]);
    for (const id of a.world.truth.ids(ORG_LOYALTY)) {
      const org = councilRows(a.world.truth).find((r) => r.id === (id as string))?.org;
      const l = a.world.truth.get(ORG_LOYALTY, id);
      if (org && l) expect(loyaltyViolations(org, l)).toEqual([]);
    }
  });
});
