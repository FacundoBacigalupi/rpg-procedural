import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type AgentId, type EventId, ledgerUnit, Rng } from "../../core/index.ts";
import { lend } from "./credit.ts";
import {
  beliefConfidence,
  believePledge,
  bookOf,
  decideKeep,
  disputes,
  isPledgeOverdue,
  learnOutcome,
  makePledge,
  PLEDGE_BOOK_CAPACITY,
  pledgeGuilt,
  rehearse,
  remember,
  resolvePledge,
  weightOfGive,
} from "./index.ts";

const DAY = 86_400;
const ana = "agent:1" as AgentId;
const bruno = "agent:2" as AgentId;
const grain = ledgerUnit("grain");

const give = (grams: number) => ({ kind: "give" as const, unit: grain, grams });
const pledge = (precision = 1, grams = 1000) =>
  makePledge({
    promisor: ana,
    promisee: bruno,
    term: give(grams),
    at: 0,
    weight: weightOfGive(grams),
    precision,
  });

describe("promesas: verdad", () => {
  it("vence pasada la gracia y se cierra una sola vez", () => {
    const p = pledge();
    expect(isPledgeOverdue(p, 30 * DAY)).toBe(false);
    expect(isPledgeOverdue(p, 38 * DAY)).toBe(true);
    const kept = resolvePledge(p, "kept", "event:1" as EventId);
    expect(kept.status).toBe("kept");
    expect(resolvePledge(kept, "broken", "event:2" as EventId)).toBe(kept);
    expect(isPledgeOverdue(kept, 99 * DAY)).toBe(false);
  });

  it("sin plazo nunca vence sola", () => {
    const p = makePledge({
      promisor: ana,
      promisee: bruno,
      term: { kind: "favor", what: "ayudar" },
      at: 0,
      dueInDays: null,
      weight: 0.3,
    });
    expect(isPledgeOverdue(p, 9999 * DAY)).toBe(false);
  });
});

describe("promesas: creencias", () => {
  it("con términos claros las dos partes entienden lo mismo; con vagos, no", () => {
    const rng = Rng.root(7);
    const clear = pledge(1);
    const a = believePledge("commitment:1", clear, "promisor", rng.fork("a"));
    const b = believePledge("commitment:1", clear, "promisee", rng.fork("b"));
    expect(disputes(a, b)).toBe(false);
    expect(a.due).toBe(clear.due);
    let differ = 0;
    for (let i = 0; i < 40; i++) {
      const vague = pledge(0.1);
      const x = believePledge("commitment:1", vague, "promisor", rng.fork("x", i));
      const y = believePledge("commitment:1", vague, "promisee", rng.fork("y", i));
      if (disputes(x, y)) differ++;
    }
    expect(differ).toBeGreaterThan(20);
  });

  it("el que cobra tiende a recordar más de lo prometido que el que debe", () => {
    const vague = pledge(0.2);
    let owes = 0;
    let owed = 0;
    for (let i = 0; i < 200; i++) {
      const rng = Rng.root(3).fork(i);
      const x = believePledge("commitment:1", vague, "promisor", rng.fork("p"));
      const y = believePledge("commitment:1", vague, "promisee", rng.fork("q"));
      if (x.term.kind === "give") owes += x.term.grams;
      if (y.term.kind === "give") owed += y.term.grams;
    }
    expect(owed).toBeGreaterThan(owes);
  });

  it("la confianza decae sin repasar y repasar la renueva", () => {
    const b = believePledge("commitment:1", pledge(), "promisee", Rng.root(1));
    const later = 200 * DAY;
    expect(beliefConfidence(b, later)).toBeLessThan(beliefConfidence(b, DAY));
    expect(beliefConfidence(rehearse(b, later), later)).toBeGreaterThan(beliefConfidence(b, later));
  });

  it("el libro olvida lo cerrado y lo menos seguro al llenarse", () => {
    let book = remember(
      undefined,
      believePledge("commitment:0", pledge(), "promisor", Rng.root(1)),
      0,
    );
    for (let i = 1; i <= PLEDGE_BOOK_CAPACITY + 5; i++) {
      book = remember(
        book,
        believePledge(`commitment:${i}`, pledge(), "promisor", Rng.root(1).fork(i)),
        i,
      );
    }
    expect(book.items).toHaveLength(PLEDGE_BOOK_CAPACITY);
    const closed = learnOutcome(book, "commitment:29", "kept", 10);
    expect(closed?.items.find((b) => b.pledge === "commitment:29")?.status).toBe("kept");
  });

  it("determinismo: misma clave, misma creencia", () => {
    const f = () => believePledge("commitment:1", pledge(0.3), "promisee", Rng.root(9).fork("t"));
    expect(f()).toEqual(f());
  });
});

describe("promesas: culpa y decisión", () => {
  const scrupulous = { tradition: 0.1, justice: 0.1, family: 0.1, status: 0.05 };
  const cynic = { tradition: 0.02, justice: 0.02, family: 0.02, status: 0.02 };

  it("el de valores firmes siente más culpa; lo trivial y lo cercano la cambian", () => {
    const heavy = pledge(1, 3000);
    const light = pledge(1, 20);
    const ctx = { close: false, harm: 0.5 };
    expect(pledgeGuilt(scrupulous, heavy, ctx)).toBeGreaterThan(pledgeGuilt(cynic, heavy, ctx));
    expect(pledgeGuilt(scrupulous, heavy, ctx)).toBeGreaterThan(
      pledgeGuilt(scrupulous, light, ctx),
    );
    expect(pledgeGuilt(scrupulous, heavy, { ...ctx, close: true })).toBeGreaterThan(
      pledgeGuilt(scrupulous, heavy, ctx),
    );
  });

  it("la culpa está acotada", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.integer({ min: 1, max: 100000 }),
        (v, harm, grams) => {
          const g = pledgeGuilt(
            { tradition: v, justice: v, family: v, status: v },
            pledge(1, grams),
            {
              close: true,
              harm,
              gratitude: 1,
            },
          );
          expect(g).toBeGreaterThanOrEqual(0);
          expect(g).toBeLessThanOrEqual(1);
        },
      ),
    );
  });

  it("incumplir conviene si ahorra mucho y nadie lo ve, y deja de convenir con culpa", () => {
    const base = {
      cost: 0.5,
      saving: 0.5,
      relationValue: 0.1,
      detect: 0.1,
      sanction: 0.4,
      guilt: 0,
    };
    expect(decideKeep(base).keep).toBe(false);
    expect(decideKeep({ ...base, guilt: 1 }).keep).toBe(true);
    expect(decideKeep({ ...base, detect: 1, sanction: 1 }).keep).toBe(true);
  });
});

describe("libro de deudas y promesas", () => {
  it("junta el fiado exacto con las promesas como se creen, lo que debo primero", () => {
    const credit = lend(bruno, ana, grain, 500, 0, DAY);
    const p = pledge(1);
    const mine = believePledge("commitment:9", p, "promisor", Rng.root(1));
    const theirs = {
      ...believePledge("commitment:8", p, "promisee", Rng.root(1)),
      other: bruno,
    };
    const book = remember(remember(undefined, theirs, 0), mine, 0);
    const entries = bookOf(ana, [{ id: "commitment:3", credit }], book, DAY);
    expect(entries.map((e) => [e.kind, e.direction])).toEqual([
      ["debt", "i-owe"],
      ["pledge", "i-owe"],
      ["pledge", "owed-to-me"],
    ]);
    expect(entries[0]?.confidence).toBe(1);
    // Una promesa que ya se cerró no figura.
    const closed = learnOutcome(book, "commitment:9", "kept", DAY);
    expect(bookOf(ana, [], closed, DAY).map((e) => e.id)).toEqual(["commitment:8"]);
  });

  it("lo que el personaje olvidó figura con poca confianza, no con la verdad", () => {
    const b = believePledge("commitment:9", pledge(), "promisor", Rng.root(1));
    const [entry] = bookOf(ana, [], { items: [b] }, 400 * DAY);
    expect(entry?.confidence).toBeLessThan(b.confidence);
  });
});
