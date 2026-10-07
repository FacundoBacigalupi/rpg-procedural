import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  EARTHLIKE_CLOCK,
  type Event,
  EventLog,
  IdAllocator,
  makeId,
  Rng,
  type SettlementId,
} from "../../core/index.ts";
import { table, WorldTruth } from "../world/index.ts";
import {
  addToField,
  type ProcessContext,
  type ProcessDef,
  type ProcessResult,
  Scheduler,
  SchedulerError,
  type SchedulerState,
  type StepReport,
  setComponent,
} from "./index.ts";

const DAY = EARTHLIKE_CLOCK.day;
const STOCK = table<{ amount: number }>("stock");
const S1 = makeId("settlement", 1);
const S2 = makeId("settlement", 2);
const S3 = makeId("settlement", 3);

function place(s: SettlementId) {
  return { kind: "settlement", settlement: s } as const;
}

function def(
  id: string,
  run: (ctx: ProcessContext) => ProcessResult,
  over: Partial<ProcessDef> = {},
): ProcessDef {
  return {
    id,
    system: id.split(".")[0] as string,
    scope: "world",
    cadence: { local: "day" },
    representation: "individual",
    phase: "physics",
    reads: ["stock"],
    writes: ["stock"],
    run,
    ...over,
  };
}

/** Cada asentamiento suma una tirada a su stock por día y deja un evento. */
const grow = def(
  "econ.grow",
  (ctx) => {
    const s = ctx.scope as SettlementId;
    const n = ctx.rng.int(1, 10);
    return {
      changes: [addToField(STOCK, s, "amount", n)],
      events: [
        {
          kind: "grow",
          actors: [s],
          place: place(s),
          data: { n },
          emissions: {},
          causes: [{ kind: "state", entity: s, key: "stock" }],
        },
      ],
    };
  },
  { scope: "settlement" },
);

/** Consume rng y no hace nada: no tiene que mover las tiradas de nadie más. */
const noop = def("zzz.noop", (ctx) => {
  ctx.rng.float();
  ctx.rng.normal();
  return {};
});

function world(
  seed: number,
  processes: readonly ProcessDef[],
  settlements = [S1, S2, S3],
  state?: SchedulerState,
  truth = seeded(settlements),
  ids = new IdAllocator(),
  log = new EventLog(),
) {
  const scheduler = new Scheduler(
    {
      rng: Rng.root(seed),
      clock: EARTHLIKE_CLOCK,
      truth,
      ids,
      log,
      processes,
      resolution: "local",
      scopes: (kind, t) => (kind === "settlement" ? [...t.ids(STOCK)].reverse() : []),
    },
    state,
  );
  return { truth, ids, log, scheduler };
}

function seeded(settlements: readonly SettlementId[]) {
  const truth = new WorldTruth();
  for (const s of settlements) truth.set(STOCK, s, { amount: 0 });
  return truth;
}

function runFor(w: ReturnType<typeof world>, until: number) {
  const events: Event[] = [];
  w.scheduler.advanceTo(until, (r) => events.push(...r.events));
  return { rows: w.truth.rows(), events };
}

const seeds = fc.nat({ max: 0xffffffff });

describe("pasos y ventanas", () => {
  it("lo periódico corre al borde de cada ventana, cubriendo la que terminó", () => {
    const seen: { now: number; window: number; index: number | undefined }[] = [];
    const p = def("t.watch", (ctx) => {
      seen.push({ now: ctx.now, window: ctx.window, index: ctx.windowIndex });
      return {};
    });
    const w = world(1, [p]);
    const r = w.scheduler.advanceTo(3 * DAY + 5);
    expect(r).toEqual({ now: 3 * DAY + 5, interrupted: false, steps: 3 });
    expect(seen).toEqual([
      { now: DAY, window: DAY, index: 0 },
      { now: 2 * DAY, window: DAY, index: 1 },
      { now: 3 * DAY, window: DAY, index: 2 },
    ]);
    expect(w.scheduler.nextStepTick()).toBe(4 * DAY);
  });

  it("sin procesos ni ítems, avanzar solo mueve el reloj", () => {
    const w = world(1, []);
    expect(w.scheduler.nextStepTick()).toBeUndefined();
    expect(w.scheduler.advanceTo(1000)).toEqual({ now: 1000, interrupted: false, steps: 0 });
    expect(() => w.scheduler.advanceTo(999)).toThrow(SchedulerError);
  });

  it("un proceso sin cadencia a esta resolución no corre", () => {
    let runs = 0;
    const p = def(
      "t.far",
      () => {
        runs++;
        return {};
      },
      { cadence: { world: "day" } },
    );
    world(1, [p]).scheduler.advanceTo(10 * DAY);
    expect(runs).toBe(0);
  });

  it("las fases corren en orden fijo y cada una ve lo que asentó la anterior", () => {
    const log: string[] = [];
    const mk = (phase: ProcessDef["phase"]) =>
      def(
        `t.${phase}`,
        (ctx) => {
          log.push(`${phase}:${ctx.truth.get(STOCK, S1)?.amount}`);
          return { changes: [addToField(STOCK, S1, "amount", 1)] };
        },
        { phase },
      );
    const w = world(1, [mk("settle"), mk("act"), mk("perceive"), mk("physics"), mk("decide")]);
    w.scheduler.advanceTo(DAY);
    expect(log).toEqual(["perceive:0", "decide:1", "act:2", "physics:3", "settle:4"]);
  });

  it("dentro de una fase todas las corridas leen el mismo estado", () => {
    const read: number[] = [];
    const p = def(
      "t.read",
      (ctx) => {
        read.push(ctx.truth.get(STOCK, S1)?.amount ?? -1);
        return { changes: [addToField(STOCK, S1, "amount", 1)] };
      },
      { scope: "settlement" },
    );
    const w = world(1, [p]);
    w.scheduler.advanceTo(DAY);
    expect(read).toEqual([0, 0, 0]);
    expect(w.truth.get(STOCK, S1)?.amount).toBe(3);
  });
});

describe("determinismo", () => {
  it("mismo seed, mismo mundo y mismos eventos", () => {
    fc.assert(
      fc.property(seeds, (seed) => {
        const a = runFor(world(seed, [grow, noop]), 20 * DAY);
        const b = runFor(world(seed, [grow, noop]), 20 * DAY);
        expect(a).toEqual(b);
      }),
      { numRuns: 30 },
    );
  });

  it("el orden de registro de procesos y alcances no importa", () => {
    fc.assert(
      fc.property(seeds, (seed) => {
        const a = runFor(world(seed, [grow, noop], [S1, S2, S3]), 10 * DAY);
        const b = runFor(world(seed, [noop, grow], [S3, S1, S2]), 10 * DAY);
        expect(a).toEqual(b);
      }),
      { numRuns: 30 },
    );
  });

  it("sumar un proceso que tira dados no cambia las tiradas de los demás", () => {
    fc.assert(
      fc.property(seeds, (seed) => {
        const a = runFor(world(seed, [grow]), 10 * DAY);
        const b = runFor(world(seed, [grow, noop]), 10 * DAY);
        expect(a).toEqual(b);
      }),
      { numRuns: 30 },
    );
  });

  it("avanzar de a pedazos da lo mismo que de una vez", () => {
    fc.assert(
      fc.property(seeds, fc.array(fc.nat({ max: 3 * DAY }), { maxLength: 6 }), (seed, hops) => {
        const whole = runFor(world(seed, [grow]), 10 * DAY);
        const w = world(seed, [grow]);
        const events: Event[] = [];
        let t = 0;
        for (const h of hops) {
          t = Math.min(10 * DAY, t + h);
          w.scheduler.advanceTo(t, (r) => events.push(...r.events));
        }
        w.scheduler.advanceTo(10 * DAY, (r) => events.push(...r.events));
        expect({ rows: w.truth.rows(), events }).toEqual(whole);
      }),
      { numRuns: 30 },
    );
  });

  it("guardar y restaurar el estado sigue exactamente igual", () => {
    fc.assert(
      fc.property(seeds, fc.nat({ max: 10 * DAY }), (seed, cut) => {
        const procs = [grow, chain];
        const whole = world(seed, procs);
        whole.scheduler.schedule({
          at: 7,
          phase: "act",
          process: "t.chain",
          scope: "world",
          reason,
        });
        const all = runFor(whole, 10 * DAY);

        const first = world(seed, procs);
        first.scheduler.schedule({
          at: 7,
          phase: "act",
          process: "t.chain",
          scope: "world",
          reason,
        });
        const head = runFor(first, cut);
        const saved = JSON.parse(JSON.stringify(first.scheduler.state())) as SchedulerState;
        const truth = new WorldTruth();
        for (const r of first.truth.rows()) truth.setRaw(r.table, r.id, r.value);
        const log = EventLog.from(first.log.all());
        const ids = new IdAllocator(first.ids.state());
        const second = world(seed, procs, [], saved, truth, ids, log);
        const tail = runFor(second, 10 * DAY);
        expect({ rows: tail.rows, events: [...head.events, ...tail.events] }).toEqual(all);
      }),
      { numRuns: 30 },
    );
  });
});

const reason = { kind: "seed" } as const;

/** Se reagenda a sí mismo cada tanto, tirando cuándo. */
const chain = def(
  "t.chain",
  (ctx) => ({
    changes: [addToField(STOCK, S1, "amount", 100)],
    schedule: [
      {
        at: ctx.now + ctx.rng.int(1, DAY),
        phase: "act",
        process: "t.chain",
        scope: "world",
        reason,
      },
    ],
  }),
  { cadence: { local: "onEvent" } },
);

describe("cola de ítems", () => {
  it("un ítem corre en su tick y fase, con el ítem en el contexto", () => {
    const seen: (string | undefined)[] = [];
    const p = def(
      "t.once",
      (ctx) => {
        seen.push(`${ctx.now}:${ctx.phase}:${ctx.item?.seq}:${ctx.window}:${ctx.windowIndex}`);
        return {};
      },
      { cadence: { local: "onEvent" }, phase: "decide" },
    );
    const w = world(1, [p]);
    w.scheduler.schedule({ at: 500, phase: "decide", process: "t.once", scope: "world", reason });
    w.scheduler.schedule({ at: 200, phase: "decide", process: "t.once", scope: "world", reason });
    expect(w.scheduler.nextStepTick()).toBe(200);
    expect(w.scheduler.advanceTo(1000).steps).toBe(2);
    expect(seen).toEqual(["200:decide:1:0:undefined", "500:decide:0:0:undefined"]);
    expect(w.scheduler.state().queue).toEqual([]);
  });

  it("un proceso puede agendar en una fase posterior del mismo paso", () => {
    const log: string[] = [];
    const later = def(
      "t.later",
      (ctx) => {
        log.push(`later@${ctx.now}`);
        return {};
      },
      { cadence: { local: "onEvent" }, phase: "settle" },
    );
    const first = def(
      "t.first",
      (ctx) => {
        log.push(`first@${ctx.now}`);
        return {
          schedule: [{ at: ctx.now, phase: "settle", process: "t.later", scope: "world", reason }],
        };
      },
      { phase: "act" },
    );
    world(1, [first, later]).scheduler.advanceTo(DAY);
    expect(log).toEqual([`first@${DAY}`, `later@${DAY}`]);
  });

  it("agendar en el pasado o a un proceso desconocido es un error", () => {
    const back = def("t.back", (ctx) => ({
      schedule: [{ at: ctx.now, phase: "perceive", process: "t.back", scope: "world", reason }],
    }));
    const w = world(1, [back]);
    expect(() =>
      w.scheduler.schedule({ at: 0, phase: "act", process: "t.back", scope: "world", reason }),
    ).toThrow(SchedulerError);
    expect(() =>
      w.scheduler.schedule({ at: 5, phase: "act", process: "nope.x", scope: "world", reason }),
    ).toThrow(SchedulerError);
    expect(() => w.scheduler.advanceTo(DAY)).toThrow(/pasado/);
  });

  it("los ítems de la misma corrida llevan rng distintos por ordinal", () => {
    const rolls: number[] = [];
    const p = def(
      "t.roll",
      (ctx) => {
        rolls.push(ctx.rng.u32());
        return {};
      },
      { cadence: { local: "onEvent" } },
    );
    const w = world(9, [p]);
    for (let i = 0; i < 3; i++) {
      w.scheduler.schedule({ at: 10, phase: "act", process: "t.roll", scope: "world", reason });
    }
    w.scheduler.advanceTo(10);
    expect(new Set(rolls).size).toBe(3);
  });
});

describe("diffs y conflictos", () => {
  it("las sumas conmutan: dos procesos que suman al mismo campo no chocan", () => {
    const a = def("a.add", () => ({ changes: [addToField(STOCK, S1, "amount", 2)] }));
    const b = def("b.add", () => ({ changes: [addToField(STOCK, S1, "amount", 5)] }));
    const w = world(1, [a, b]);
    w.scheduler.advanceTo(2 * DAY);
    expect(w.truth.get(STOCK, S1)?.amount).toBe(14);
  });

  it("escribir en exclusiva lo mismo fuera de act es un error", () => {
    const a = def("a.set", () => ({ changes: [setComponent(STOCK, S1, { amount: 1 })] }));
    const b = def("b.add", () => ({ changes: [addToField(STOCK, S1, "amount", 5)] }));
    expect(() => world(1, [a, b]).scheduler.advanceTo(DAY)).toThrow(/conflicto/);
  });

  it("escribir una tabla sin declararla es un error", () => {
    const a = def("a.sneak", () => ({ changes: [setComponent(STOCK, S1, { amount: 1 })] }), {
      writes: [],
    });
    expect(() => world(1, [a]).scheduler.advanceTo(DAY)).toThrow(/writes/);
  });

  it("sumar a lo que no existe o borrar lo que no está es un error", () => {
    const a = def("a.add", () => ({ changes: [addToField(STOCK, S2, "amount", 1)] }));
    expect(() => world(1, [a], [S1]).scheduler.advanceTo(DAY)).toThrow(SchedulerError);
  });

  it("un evento con tick fuera de su ventana es un error", () => {
    const a = def("a.ev", (ctx) => ({
      events: [
        {
          tick: ctx.now + 1,
          kind: "x",
          actors: [],
          place: place(S1),
          data: null,
          emissions: {},
          causes: [{ kind: "seed" }],
        },
      ],
    }));
    expect(() => world(1, [a]).scheduler.advanceTo(DAY)).toThrow(/ventana/);
  });

  it("los eventos reciben ids en orden canónico, la resolución y el tick", () => {
    const w = world(3, [grow]);
    const { events } = runFor(w, 2 * DAY);
    expect(events.map((e) => [e.id, e.tick, e.actors[0], e.resolution])).toEqual([
      ["event:1", DAY, S1, "local"],
      ["event:2", DAY, S2, "local"],
      ["event:3", DAY, S3, "local"],
      ["event:4", 2 * DAY, S1, "local"],
      ["event:5", 2 * DAY, S2, "local"],
      ["event:6", 2 * DAY, S3, "local"],
    ]);
  });
});

describe("contiendas", () => {
  const grab = (id: string, value: number, initiative: number) =>
    def(
      id,
      (ctx) => ({
        changes: [setComponent(STOCK, S1, { amount: value })],
        events: [
          {
            kind: "grab",
            actors: [],
            place: place(S1),
            data: value,
            emissions: {},
            causes: [{ kind: "seed" }],
          },
        ],
        schedule: [{ at: ctx.now + 1, phase: "act", process: "t.after", scope: "world", reason }],
        contest: { initiative, place: place(S1), actor: makeId("agent", value) },
      }),
      { phase: "act" },
    );
  const after = def("t.after", () => ({}), { cadence: { local: "onEvent" } });

  it("gana una sola corrida, entera; la otra se descarta con sus eventos e ítems", () => {
    fc.assert(
      fc.property(seeds, (seed) => {
        const w = world(seed, [grab("a.grab", 1, 0), grab("b.grab", 2, 0), after]);
        const reports: StepReport[] = [];
        w.scheduler.advanceTo(DAY, (r) => reports.push(r));
        const [report] = reports;
        expect(report?.contests).toHaveLength(1);
        const contest = report?.contests[0];
        const winner = contest?.contenders[contest.winner];
        const value = winner?.process === "a.grab" ? 1 : 2;
        expect(w.truth.get(STOCK, S1)?.amount).toBe(value);
        expect(report?.events.map((e) => [e.id, e.kind, e.data])).toEqual([
          ["event:1", "contest", contest],
          ["event:2", "grab", value],
        ]);
        expect(report?.events[0]?.actors).toEqual([makeId("agent", 1), makeId("agent", 2)]);
        expect(report?.events[0]?.causes).toEqual([{ kind: "state", entity: S1, key: "stock" }]);
        expect(w.scheduler.state().queue).toHaveLength(1);
      }),
      { numRuns: 50 },
    );
  });

  it("la iniciativa pesa: con mucha ventaja casi siempre gana el mismo", () => {
    let wins = 0;
    for (let seed = 0; seed < 200; seed++) {
      const w = world(seed, [grab("a.grab", 1, 0), grab("b.grab", 2, 3), after]);
      w.scheduler.advanceTo(DAY);
      if (w.truth.get(STOCK, S1)?.amount === 2) wins++;
    }
    expect(wins).toBeGreaterThan(190);
  });

  it("con iniciativas iguales, las dos ganan alguna vez", () => {
    const winners = new Set<number | undefined>();
    for (let seed = 0; seed < 40; seed++) {
      const w = world(seed, [grab("a.grab", 1, 0), grab("b.grab", 2, 0), after]);
      w.scheduler.advanceTo(DAY);
      winners.add(w.truth.get(STOCK, S1)?.amount);
    }
    expect(winners).toEqual(new Set([1, 2]));
  });

  it("disputar sin declarar iniciativa es un error", () => {
    const bare = def("c.grab", () => ({ changes: [setComponent(STOCK, S1, { amount: 9 })] }), {
      phase: "act",
    });
    expect(() => world(1, [grab("a.grab", 1, 0), bare, after]).scheduler.advanceTo(DAY)).toThrow(
      /iniciativa/,
    );
  });
});

describe("interrupciones", () => {
  it("advanceUntil corta después del paso que lo pide", () => {
    const w = world(1, [grow]);
    const r = w.scheduler.advanceUntil(10 * DAY, (rep) => rep.tick >= 3 * DAY);
    expect(r).toEqual({ now: 3 * DAY, interrupted: true, steps: 3 });
    expect(w.scheduler.now).toBe(3 * DAY);
  });

  it("entre pasos (en el observador) se puede agendar desde afuera", () => {
    const w = world(1, [grow]);
    expect(() =>
      w.scheduler.advanceTo(DAY, () =>
        w.scheduler.schedule({
          at: 2 * DAY,
          phase: "act",
          process: "econ.grow",
          scope: S1,
          reason,
        }),
      ),
    ).not.toThrow();
  });
});

describe("validación de procesos", () => {
  it("ids repetidos o fuera de su sistema son un error", () => {
    expect(() => world(1, [grow, grow])).toThrow(/repetido/);
    expect(() => world(1, [def("econ.x", () => ({}), { system: "body" })])).toThrow(/sistema/);
  });
});
