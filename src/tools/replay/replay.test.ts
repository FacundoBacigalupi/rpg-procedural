import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentId, Seed, Tick } from "../../core/index.ts";
import { type LifeState, LifeStore, openSqlite, type SqlDriver } from "../../persistence/index.ts";
import { createEntity, draftEvent, ENTITY, hashState, setComponent } from "../../sim/index.ts";
import {
  DAY,
  death,
  def,
  HUT,
  living,
  PROCESSES,
  VILLAGE,
  village,
} from "../../sim/scheduler/village.fixture.ts";
import {
  ReplayError,
  type ReplayGame,
  type ReplayRun,
  replay,
  replayInputFromStore,
} from "./index.ts";

/** El plan de juguete: que un aldeano levante una choza al tick siguiente. */
interface Order {
  readonly builder: AgentId;
}

const order = def(
  "demo.order",
  (ctx) => {
    const me = ctx.scope as AgentId;
    if (ctx.truth.get(ENTITY, me)?.endedAt !== undefined || !ctx.item) return {};
    const hut = ctx.newId("building");
    const built = draftEvent(0);
    return {
      events: [
        {
          kind: "build",
          actors: [me],
          place: { kind: "building", building: hut },
          data: null,
          emissions: {},
          causes: [ctx.item.reason],
        },
      ],
      changes: [createEntity(hut, built, ctx.now), setComponent(HUT, hut, { owner: me })],
    };
  },
  { cadence: { local: "onEvent" }, phase: "act", writes: ["entity", "hut"] },
);

const VERSIONS = { engine: "test", content: "none", format: 1 };

type Village = ReturnType<typeof village>;

function stateOf(w: Village): LifeState {
  return {
    truth: w.truth,
    log: w.log,
    ledger: w.ledger,
    ids: w.ids.state(),
    scheduler: w.scheduler.state(),
  };
}

function runOf(w: Village): ReplayRun<Order> {
  return {
    advanceTo: (t) => void w.scheduler.advanceTo(t),
    submit: (plan, seq) =>
      void w.scheduler.schedule({
        at: w.scheduler.now + 1,
        phase: "act",
        process: order.id,
        scope: plan.builder,
        reason: { kind: "state", entity: VILLAGE, key: `orders.${seq}` },
      }),
    hash: () => hashState(stateOf(w)),
  };
}

function game(processes = [...PROCESSES, order]): ReplayGame<null, Order> {
  return { versions: VERSIONS, start: (seed) => runOf(village(seed, processes)) };
}

const opened: SqlDriver[] = [];
afterEach(() => {
  for (const db of opened.splice(0)) db.close();
});

/** Juega una vida: en cada parada guarda un checkpoint y a veces da una orden. */
function play(seed: Seed, stops: readonly number[]): LifeStore {
  const db = openSqlite(":memory:");
  opened.push(db);
  const store = LifeStore.open(db);
  store.setMeta("seed", seed);
  store.setMeta("versions", VERSIONS);
  store.setMeta("setup", null);
  const w = village(seed, [...PROCESSES, order]);
  const run = runOf(w);
  let t: Tick = 0;
  for (const [i, stop] of stops.entries()) {
    t += stop * DAY;
    run.advanceTo(t);
    store.saveSnapshot(stateOf(w));
    const alive = living(w.truth);
    if (alive.length > 0) {
      const plan: Order = { builder: alive[i % alive.length] as AgentId };
      const seq = store.appendPlan(t, plan);
      run.submit(plan, seq, t);
    }
  }
  run.advanceTo(t + 5 * DAY);
  store.save(stateOf(w));
  return store;
}

const stops = fc.array(fc.integer({ min: 1, max: 15 }), { minLength: 1, maxLength: 6 });

describe("replay", () => {
  it("desde seed + planes llega al mismo estado, checkpoint por checkpoint", () => {
    fc.assert(
      fc.property(fc.nat({ max: 0xffffffff }), stops, (seed, legs) => {
        const store = play(seed, legs);
        const { input, checkpoints } = replayInputFromStore(store);
        const end = store.load().scheduler.now;
        const report = replay(input, game(), { checkpoints, until: end });
        expect(report.divergence).toBeUndefined();
        expect(report.checked).toBe(legs.length);
        expect(report.hash).toEqual(hashState(store.load()));
      }),
      { numRuns: 10 },
    );
  });

  it("sin los planes, diverge en el primer checkpoint después de la primera orden", () => {
    const store = play(21, [5, 5, 5]);
    const { input, checkpoints } = replayInputFromStore(store);
    // Sin planes, los primeros checkpoints coinciden igual hasta que la orden cambió algo.
    const report = replay({ ...input, plans: [] }, game(), { checkpoints });
    expect(report.divergence?.tick).toBe(10 * DAY);
    expect(report.checked).toBe(2);
    expect(report.divergence?.parts).toEqual(
      expect.arrayContaining(["c:entity", "c:hut", "events", "ids", "scheduler"]),
    );
  });

  it("una regla cambiada se detecta y dice qué partes divergen", () => {
    const store = play(8, [10, 10]);
    const { input, checkpoints } = replayInputFromStore(store);
    // Nadie muere: en 10 días con un 15% diario por aldeano, alguno tendría que haber muerto.
    const immortal = { ...death, run: () => ({}) };
    const changed = PROCESSES.map((p) => (p.id === death.id ? immortal : p));
    const report = replay(input, game([...changed, order]), { checkpoints });
    expect(report.divergence?.tick).toBe(10 * DAY);
    expect(report.divergence?.parts).toContain("c:entity");
  });

  it("rechaza otra versión, planes desordenados y guardados incompletos", () => {
    const store = play(3, [2]);
    const { input } = replayInputFromStore(store);
    expect(() =>
      replay(
        { ...input, versions: { ...VERSIONS, engine: "otro" } },
        game() as ReplayGame<unknown, unknown>,
      ),
    ).toThrow(ReplayError);
    const plan = { builder: "agent:1" };
    expect(() =>
      replay(
        {
          ...input,
          plans: [
            { seq: 0, tick: 10, plan },
            { seq: 1, tick: 5, plan },
          ],
        },
        game() as ReplayGame<unknown, unknown>,
      ),
    ).toThrow(/fuera de orden/);
    const db = openSqlite(":memory:");
    opened.push(db);
    expect(() => replayInputFromStore(LifeStore.open(db))).toThrow(/setup, versions/);
  });
});
