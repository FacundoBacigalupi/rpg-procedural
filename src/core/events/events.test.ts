import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type EventId, makeId } from "../ids/index.ts";
import type { CauseRef, Event } from "../types/index.ts";
import { EventLog, EventLogError } from "./index.ts";

const E = (n: number) => makeId("event", n);
const S1 = makeId("settlement", 1);

function ev(
  n: number,
  tick: number,
  causes: readonly CauseRef[],
  over: Partial<Event> = {},
): Event {
  return {
    id: E(n),
    tick,
    kind: "test",
    actors: [],
    place: { kind: "settlement", settlement: S1 },
    data: null,
    emissions: {},
    causes,
    resolution: "local",
    ...over,
  };
}

const seed: CauseRef[] = [{ kind: "seed" }];
const citing = (n: number): CauseRef[] => [{ kind: "event", event: E(n) }];

/** Un historial al azar: cada evento cita algunos de los anteriores (o el seed si es el primero). */
const histories = fc
  .array(
    fc.record({
      dt: fc.nat({ max: 100 }),
      gap: fc.nat({ max: 2 }),
      picks: fc.array(fc.nat(), { maxLength: 3 }),
    }),
    {
      minLength: 1,
      maxLength: 40,
    },
  )
  .map((specs) => {
    const events: Event[] = [];
    let tick = -50;
    let n = 0;
    for (const s of specs) {
      tick += s.dt;
      n += 1 + s.gap;
      const causes: CauseRef[] =
        events.length === 0 || s.picks.length === 0
          ? seed
          : s.picks.map((p) => ({ kind: "event", event: (events[p % events.length] as Event).id }));
      events.push(ev(n, tick, causes));
    }
    return events;
  });

describe("EventLog", () => {
  it("acepta historiales bien formados y los devuelve en orden", () => {
    fc.assert(
      fc.property(histories, (events) => {
        const log = EventLog.from(events);
        expect(log.size).toBe(events.length);
        expect(log.all().map((e) => e.id)).toEqual(events.map((e) => e.id));
        expect(EventLog.from(log.all()).all()).toEqual(log.all());
      }),
    );
  });

  it("causas y efectos son el mismo grafo visto de los dos lados, sin ciclos", () => {
    fc.assert(
      fc.property(histories, (events) => {
        const log = EventLog.from(events);
        for (const e of events) {
          const anc = log.ancestors(e.id);
          expect(anc).not.toContain(e.id);
          expect(log.ancestors(e.id, 1)).toEqual([...new Set(log.causesOf(e.id))].sort(byN));
          for (const a of anc) {
            expect(log.descendants(a)).toContain(e.id);
            expect((log.get(a) as Event).tick).toBeLessThanOrEqual(e.tick);
          }
          for (const c of log.effectsOf(e.id)) expect(log.causesOf(c)).toContain(e.id);
        }
      }),
    );
  });

  it("los eventos guardados no se pueden modificar", () => {
    const log = EventLog.from([ev(1, 0, seed)]);
    const e = log.get(E(1)) as Event;
    expect(Object.isFrozen(e)).toBe(true);
    expect(Object.isFrozen(e.causes)).toBe(true);
  });

  it.each<[string, Event]>([
    ["sin causas", ev(2, 5, [])],
    ["id fuera de orden", ev(1, 5, citing(1))],
    ["causa inexistente", ev(3, 5, citing(2))],
    ["causa posterior", ev(2, -1, citing(1))],
    ["id que no es de evento", { ...ev(2, 5, citing(1)), id: "agent:2" as EventId }],
    ["tick no entero", ev(2, 0.5, citing(1))],
    [
      "resolución desconocida",
      ev(2, 5, citing(1), { resolution: "galaxy" as Event["resolution"] }),
    ],
    ["actor mal formado", ev(2, 5, citing(1), { actors: ["agent:~0" as typeof S1] })],
    ["peso negativo", ev(2, 5, [{ kind: "event", event: E(1), weight: -1 }])],
    ["estado sin clave", ev(2, 5, [{ kind: "state", entity: S1, key: "" }])],
  ])("rechaza un evento %s", (_, bad) => {
    const log = EventLog.from([ev(1, 0, seed)]);
    expect(() => log.append(bad)).toThrow(EventLogError);
    expect(log.size).toBe(1);
  });

  it("acepta huecos en la numeración y causas del mismo tick", () => {
    const log = EventLog.from([
      ev(1, 0, seed),
      ev(5, 0, citing(1)),
      ev(6, 3, [...citing(1), ...citing(5)]),
    ]);
    expect(log.lastNumber).toBe(6);
    expect(log.ancestors(E(6))).toEqual([E(1), E(5)]);
    expect(log.descendants(E(1), 1)).toEqual([E(5), E(6)]);
  });
});

function byN(a: EventId, b: EventId): number {
  return Number(a.slice(6)) - Number(b.slice(6));
}
