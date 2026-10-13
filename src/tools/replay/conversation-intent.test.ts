import { describe, expect, it } from "vitest";
import {
  EARTHLIKE_CLOCK,
  EventLog,
  externalAccount,
  holderAccount,
  IdAllocator,
  Ledger,
  ledgerUnit,
  makeId,
  Rng,
} from "../../core/index.ts";
import {
  CONVERSATION_INTENT,
  conversationSettlementProcess,
  OPEN_DEALS,
  PENDING,
  stageEconomicConversation,
} from "../../game/index.ts";
import { type LifeState, LifeStore, openSqlite } from "../../persistence/index.ts";
import {
  deleteComponent,
  draftEvent,
  ENTITY,
  HOUSEHOLD,
  hashState,
  PERSON,
  type ProcessDef,
  type ProcessResult,
  Scheduler,
  WorldTruth,
} from "../../sim/index.ts";
import { replay, replayInputFromStore } from "./index.ts";

const a = makeId("agent", 1);
const b = makeId("agent", 2);
const c = makeId("agent", 3);
const house = makeId("household", 1);
const grain = ledgerUnit("good:grain");
const larder = holderAccount(house);
const place = { kind: "cell", cell: makeId("cell", 1) } as const;
const key = "reply:agent:1:0";

function processes(): ProcessDef[] {
  return [
    {
      id: "life.test_intent",
      system: "life",
      scope: "world",
      phase: "decide",
      cadence: { local: "hour" },
      representation: "individual",
      reads: [PENDING.name, PERSON.name],
      writes: [PENDING.name, CONVERSATION_INTENT.name],
      run(ctx) {
        if (!ctx.truth.get(PENDING, b)) return {};
        const clear = deleteComponent(PENDING, b);
        const prepared: ProcessResult = {
          changes: [clear],
          events: [
            {
              kind: "action.speak",
              actors: [b, a],
              place,
              outcome: "success",
              emissions: {},
              causes: [{ kind: "state", entity: b, key }],
              data: { effect: { kind: "speak", reply: "request.give", text: "Tomá este grano." } },
            },
          ],
          postings: [
            {
              event: draftEvent(0),
              transfers: [{ from: larder, to: holderAccount(a), unit: grain, amount: 500 }],
            },
          ],
        };
        const staged = stageEconomicConversation(ctx, b, a, key, clear, prepared, {
          line: "request.short",
          text: "No me sobra grano para darte.",
        });
        // Una cita futura deja el intent pendiente en un límite guardable del scheduler.
        // El cableado del juego usa act en el mismo tick, sin este desplazamiento de la prueba.
        return {
          ...staged,
          schedule: staged.schedule?.map((item) => ({ ...item, at: ctx.now + 1 })),
        };
      },
    },
    conversationSettlementProcess([OPEN_DEALS.name]),
  ];
}

function fresh() {
  const truth = new WorldTruth();
  for (const actor of [a, b, c]) {
    truth.set(ENTITY, actor, { id: actor, originEventId: "event:1", createdAt: 0 } as never);
    truth.set(PERSON, actor, {
      household: house,
      sex: "male",
      born: 0,
      mother: null,
      father: null,
      spouse: null,
    });
  }
  truth.set(HOUSEHOLD, house, { members: [a, b, c], settlement: "settlement:1" } as never);
  truth.set(PENDING, b, { from: a, key, text: "Dame grano", clarity: 1 });
  const log = EventLog.from([
    {
      id: makeId("event", 1),
      kind: "initial",
      tick: 0,
      actors: [],
      place,
      data: {},
      emissions: {},
      causes: [{ kind: "seed" }],
      resolution: "local",
    },
  ]);
  const ledger = new Ledger({ externals: { seed: [grain] } });
  ledger.post({
    tick: 0,
    eventId: makeId("event", 1),
    transfers: [{ from: externalAccount("seed"), to: larder, unit: grain, amount: 9500 }],
  });
  return resume({
    truth,
    log,
    ledger,
    ids: { event: 2 },
    scheduler: { now: 0, seq: 0, queue: [] },
  });
}

function resume(saved: LifeState) {
  const ids = new IdAllocator(saved.ids);
  const scheduler = new Scheduler(
    {
      rng: Rng.root(7),
      clock: EARTHLIKE_CLOCK,
      truth: saved.truth,
      log: saved.log,
      ledger: saved.ledger,
      ids,
      resolution: "local",
      processes: processes(),
    },
    saved.scheduler,
  );
  const state = (): LifeState => ({
    truth: saved.truth,
    log: saved.log,
    ledger: saved.ledger,
    ids: ids.state(),
    scheduler: scheduler.state(),
  });
  return { ...saved, ids, scheduler, state, hash: () => hashState(state()) };
}

describe("intención económica pendiente: persistencia, replay y factibilidad al confirmar", () => {
  it("SQLite preserva el payload opaco y replay confirma la misma respuesta y transferencia", () => {
    const original = fresh();
    original.scheduler.advanceTo(3600);
    expect(original.truth.ids(CONVERSATION_INTENT)).toEqual([b]);
    expect(original.truth.ids(PENDING)).toEqual([]);
    expect(original.ledger.balance(holderAccount(a), grain)).toBe(0);
    expect(original.truth.get(CONVERSATION_INTENT, b)?.payload).toContain("event:~0");
    const db = openSqlite(":memory:");
    try {
      const store = LifeStore.open(db);
      const versions = { engine: "life-2", content: "test", format: 1 };
      store.setMeta("seed", 7);
      store.setMeta("versions", versions);
      store.setMeta("setup", {});
      store.saveSnapshot(original.state());
      store.setMeta("replayLimits", [
        { tick: 3600, from: { ...versions, engine: "life-1" }, to: versions },
      ]);
      const restored = resume(store.loadSnapshot(3600));
      expect(restored.truth.get(CONVERSATION_INTENT, b)).toEqual(
        original.truth.get(CONVERSATION_INTENT, b),
      );
      original.scheduler.advanceTo(3601);
      restored.scheduler.advanceTo(3601);
      expect(restored.hash()).toEqual(original.hash());
      expect(restored.ledger.balance(holderAccount(a), grain)).toBe(500);
      store.saveSnapshot(original.state());
      const { input, checkpoints } = replayInputFromStore(store);
      const result = replay(
        input,
        {
          versions,
          start: () => {
            throw new Error("no debe regenerar el estado inicial");
          },
          resume: (_seed, _setup, state) => {
            const world = resume(state as LifeState);
            return {
              advanceTo: (tick: number) => world.scheduler.advanceTo(tick),
              submit: () => {
                throw new Error("sin planes del jugador");
              },
              hash: world.hash,
            };
          },
        },
        { checkpoints, until: 3601 },
      );
      expect(result.divergence).toBeUndefined();
      expect(result.checked).toBe(2);
      expect(result.hash).toEqual(original.hash());
    } finally {
      db.close();
    }
  });

  it("revalida bocas actuales y no usa la reserva del momento de decidir", () => {
    const world = fresh();
    world.scheduler.advanceTo(3600);
    const child = makeId("agent", 4);
    world.truth.set(ENTITY, child, { id: child, originEventId: "event:1", createdAt: 0 } as never);
    world.truth.set(PERSON, child, {
      household: house,
      sex: "female",
      born: 0,
      mother: b,
      father: a,
      spouse: null,
    });
    world.scheduler.advanceTo(3601);
    expect(world.ledger.balance(holderAccount(a), grain)).toBe(0);
    expect(world.log.all().find((event) => event.kind === "action.speak")?.data).toMatchObject({
      economicOutcome: { accepted: false, reason: "reserve" },
    });
  });

  it.each(["dead", "holder"] as const)(
    "una intención ya inadmisible por %s no entrega ni publica aceptación",
    (reason) => {
      const world = fresh();
      world.scheduler.advanceTo(3600);
      if (reason === "dead")
        world.truth.set(ENTITY, b, {
          ...world.truth.get(ENTITY, b),
          endedAt: 3600,
          endEventId: "event:1",
        } as never);
      else world.truth.deleteRaw(HOUSEHOLD.name, house);
      world.scheduler.advanceTo(3601);
      expect(world.truth.ids(CONVERSATION_INTENT)).toEqual([]);
      expect(world.ledger.balance(holderAccount(a), grain)).toBe(0);
      if (reason === "dead") {
        expect(world.log.all().some((event) => event.kind === "action.speak")).toBe(false);
        expect(
          world.log.all().find((event) => event.kind === "dialogue.economic_cancelled")?.data,
        ).toMatchObject({ reason });
      } else
        expect(world.log.all().find((event) => event.kind === "action.speak")?.data).toMatchObject({
          economicOutcome: { accepted: false, reason },
        });
    },
  );
});
