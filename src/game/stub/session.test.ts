import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { holderAccount, IdAllocator, makeId } from "../../core/index.ts";
import { checkInvariants } from "../../sim/index.ts";
import { defaultGameSetup } from "../setup/index.ts";
import { StubSession } from "./session.ts";
import { COIN, DAY, HUT_COST, type StubPlan } from "./world.ts";

const plan = fc.oneof(
  fc.integer({ min: 60, max: 10 * DAY }).map((seconds): StubPlan => ({ verb: "wait", seconds })),
  fc.constant<StubPlan>({ verb: "look" }),
  fc.constant<StubPlan>({ verb: "build" }),
  fc
    .record({ n: fc.integer({ min: 1, max: 9 }), amount: fc.integer({ min: 1, max: 6 }) })
    .map(({ n, amount }): StubPlan => ({ verb: "give", to: makeId("agent", n), amount })),
);
const plans = fc.array(plan, { maxLength: 12 });
const seeds = fc.nat({ max: 0xffffffff });

function play(seed: number, list: readonly StubPlan[]) {
  const s = StubSession.create(seed, { villagers: 5, game: defaultGameSetup() });
  const turns = list.map((p, seq) => ({ tick: s.now, plan: p, report: s.turn(p, seq) }));
  return { s, turns };
}

describe("StubSession", () => {
  it("mismo seed y mismos planes, mismo mundo; y sigue sano", () => {
    fc.assert(
      fc.property(seeds, plans, (seed, list) => {
        const a = play(seed, list);
        const b = play(seed, list);
        expect(b.s.hash()).toEqual(a.s.hash());
        expect(checkInvariants(a.s.state())).toEqual([]);
      }),
      { numRuns: 30 },
    );
  });

  it("enviar los planes en su tick y avanzar da lo mismo que jugar los turnos (el replay)", () => {
    fc.assert(
      fc.property(seeds, plans, (seed, list) => {
        const { s, turns } = play(seed, list);
        const again = StubSession.create(seed, { villagers: 5, game: defaultGameSetup() });
        turns.forEach((t, seq) => {
          again.advanceTo(t.tick);
          again.submit(t.plan, seq);
        });
        again.advanceTo(s.now);
        expect(again.hash()).toEqual(s.hash());
      }),
      { numRuns: 30 },
    );
  });

  it("guardar el estado y seguir da lo mismo que no parar", () => {
    fc.assert(
      fc.property(seeds, plans, plans, (seed, first, second) => {
        const straight = play(seed, [...first, ...second]).s;
        const { s } = play(seed, first);
        const st = s.state();
        const resumed = StubSession.resume(seed, { ...st, ids: new IdAllocator(st.ids) });
        for (const [i, p] of second.entries()) resumed.turn(p, first.length + i);
        expect(resumed.hash()).toEqual(straight.hash());
      }),
      { numRuns: 20 },
    );
  });

  it("un turno dura lo que el plan, salvo una espera en la que alguien se mete con el personaje", () => {
    fc.assert(
      fc.property(seeds, plans, (seed, list) => {
        for (const t of play(seed, list).turns) {
          const r = t.report;
          expect(r.from).toBe(t.tick);
          if (t.plan.verb !== "wait") expect(r.interrupted).toBe(false);
          if (r.interrupted) {
            expect(r.to).toBeLessThan(t.tick + (t.plan.verb === "wait" ? t.plan.seconds : 0));
            expect(r.seen.some((e) => e.actors[0] !== "vos" && e.actors.includes("vos"))).toBe(
              true,
            );
          }
        }
      }),
      { numRuns: 30 },
    );
  });

  it("la choza cuesta lo suyo y el regalo pasa de bolsa a bolsa", () => {
    const s = StubSession.create(1, { villagers: 3, game: defaultGameSetup() });
    const start = s.view().purse;
    const r = s.turn({ verb: "build" }, 0);
    const built = r.seen.find((e) => e.actors[0] === "vos");
    if (start >= HUT_COST) {
      expect(built?.kind).toBe("build");
      expect(r.view.huts).toBe(1);
    } else {
      expect(built?.kind).toBe("build-failed");
    }
    const ledger = s.state().ledger;
    const before = ledger.balance(holderAccount(makeId("agent", 2)), COIN);
    const mine = s.view().purse;
    const give = s.turn({ verb: "give", to: makeId("agent", 2), amount: 1 }, 1);
    const gave = give.seen.find((e) => e.actors[0] === "vos");
    if (mine >= 1) {
      expect(gave).toMatchObject({
        kind: "gift",
        actors: ["vos", "aldeano 2"],
        data: { amount: 1 },
      });
      expect(ledger.balance(holderAccount(makeId("agent", 2)), COIN)).toBeGreaterThanOrEqual(
        before + 1,
      );
    }
    expect(ledger.audit()).toEqual([]);
  });

  it("un regalo a nadie o sin plata falla con forma", () => {
    const s = StubSession.create(2, { villagers: 2, game: defaultGameSetup() });
    const nobody = s.turn({ verb: "give", to: makeId("agent", 40), amount: 1 }, 0);
    expect(nobody.seen.find((e) => e.actors[0] === "vos")).toMatchObject({
      kind: "give-failed",
      data: { reason: "nobody", to: "aldeano 40" },
    });
    const broke = s.turn({ verb: "give", to: makeId("agent", 2), amount: 10_000 }, 1);
    expect(broke.seen.find((e) => e.actors[0] === "vos")).toMatchObject({
      kind: "give-failed",
      data: { reason: "coins" },
    });
  });
});
