// Una aldea de juguete con nacimientos, regalos y muertes, corrida por el scheduler con ledger y
// registro de eventos: lo que se mide son las leyes de causality (sin huérfanos, conservación,
// ningún evento sin causa, determinismo), no la aldea.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type AgentId, holderAccount, makeId } from "../../core/index.ts";
import { checkInvariants, ENTITY } from "../world/index.ts";
import { createEntity, draftEvent, SchedulerError, setComponent } from "./index.ts";
import { COIN, DAY, def, HUT, here, living, MINT, VILLAGE, village } from "./village.fixture.ts";

const seeds = fc.nat({ max: 0xffffffff });

describe("leyes de la causalidad en una corrida", () => {
  it("sin huérfanos, todo con causa y la conservación cuadra", () => {
    fc.assert(
      fc.property(seeds, fc.integer({ min: 1, max: 90 }), (seed, days) => {
        const w = village(seed);
        w.scheduler.advanceTo(days * DAY);
        expect(checkInvariants(w)).toEqual([]);
        // Toda moneda en el mundo salió de la casa de moneda por un nacimiento.
        const minted = w.ledger
          .journal()
          .filter((j) => j.from === MINT)
          .reduce((s, j) => s + j.amount, 0);
        const burned = w.ledger
          .journal()
          .filter((j) => j.to === MINT)
          .reduce((s, j) => s + j.amount, 0);
        expect(w.ledger.total(COIN)).toBe(minted - burned);
        // Los muertos no tienen nada y cada uno murió por su evento de muerte.
        for (const id of w.truth.ids(ENTITY)) {
          const base = w.truth.get(ENTITY, id);
          if (base?.endEventId === undefined) continue;
          expect(w.log.get(base.endEventId)?.kind).toBe("death");
          expect(w.ledger.balance(holderAccount(id as AgentId), COIN)).toBe(0);
        }
        // Cada nacido salió de su nacimiento, y quien saluda cita ese nacimiento.
        for (const e of w.log.all()) {
          if (e.kind === "birth")
            expect(w.truth.get(ENTITY, e.actors[0] as AgentId)?.originEventId).toBe(e.id);
          if (e.kind === "greet") {
            const [cause] = w.log.causesOf(e.id);
            expect(w.log.get(cause as typeof e.id)?.actors).toEqual(e.actors);
          }
        }
      }),
      { numRuns: 40 },
    );
  });

  it("mismo seed, mismo registro, mismo diario y misma verdad", () => {
    fc.assert(
      fc.property(seeds, (seed) => {
        const a = village(seed);
        const b = village(seed);
        a.scheduler.advanceTo(40 * DAY);
        b.scheduler.advanceTo(40 * DAY);
        expect(a.log.all()).toEqual(b.log.all());
        expect(a.ledger.journal()).toEqual(b.ledger.journal());
        expect(a.truth.rows()).toEqual(b.truth.rows());
      }),
      { numRuns: 20 },
    );
  });
});

describe("ids provisionales", () => {
  it("el perdedor de una contienda no consume ids", () => {
    const claim = (id: string, initiative: number) =>
      def(
        id,
        (ctx) => {
          const a = ctx.newId("agent");
          return {
            events: [
              {
                kind: "claim",
                actors: [a],
                place: here,
                data: null,
                emissions: {},
                causes: [{ kind: "seed" }],
              },
            ],
            changes: [
              createEntity(a, draftEvent(0), ctx.now),
              setComponent(HUT, VILLAGE, { owner: a }),
            ],
            contest: { initiative, place: here },
          };
        },
        { scope: "world", phase: "act", writes: ["entity", "hut"] },
      );
    for (let seed = 0; seed < 20; seed++) {
      const w = village(seed, [claim("demo.a", 0), claim("demo.b", 0)]);
      w.scheduler.advanceTo(DAY);
      expect(living(w.truth)).toEqual([makeId("agent", 1)]);
      expect(w.truth.get(HUT, VILLAGE)).toEqual({ owner: makeId("agent", 1) });
      // génesis, contienda, el reclamo ganador
      expect(w.log.all().map((e) => [e.id, e.kind])).toEqual([
        ["event:1", "genesis"],
        ["event:2", "contest"],
        ["event:3", "claim"],
      ]);
      expect(checkInvariants(w)).toEqual([]);
    }
  });

  it("usar un provisional que no se pidió es un error", () => {
    const bad = def(
      "demo.bad",
      (ctx) => ({ changes: [createEntity(makeId("agent", 1), draftEvent(3), ctx.now)] }),
      { scope: "world" },
    );
    expect(() => village(1, [bad]).scheduler.advanceTo(DAY)).toThrow(/no pidió ni emitió/);
  });

  it("un asiento tiene que ir por un evento de la misma corrida", () => {
    const bad = def(
      "demo.bad",
      () => ({ postings: [{ event: makeId("event", 1), transfers: [] }] }),
      { scope: "world" },
    );
    expect(() => village(1, [bad]).scheduler.advanceTo(DAY)).toThrow(SchedulerError);
  });

  it("un evento sin causas no entra al registro", () => {
    const bad = def(
      "demo.bad",
      () => ({
        events: [{ kind: "x", actors: [], place: here, data: null, emissions: {}, causes: [] }],
      }),
      { scope: "world" },
    );
    expect(() => village(1, [bad]).scheduler.advanceTo(DAY)).toThrow(/sin causas/);
  });
});
