import { describe, expect, it } from "vitest";
import { type Event, makeId } from "../../core/index.ts";
import type { OscillationYear } from "../../sim/index.ts";
import { profileOscillation } from "./oscillation-metrics.ts";

const clock = { day: 10, year: 100 };
const cause = {
  kind: "state",
  entity: makeId("settlement", 1),
  key: "oscillation:basin-1:0:cool",
} as const;
const event = (n: number, tick: number, kind: string, data: unknown = {}) =>
  ({
    id: makeId("event", n),
    tick,
    kind,
    data,
    causes: [cause],
    place: { kind: "cell", cell: makeId("cell", 1) },
  }) as Event;
const yearOf = (day: number): OscillationYear => ({
  cause: { basin: "basin-1", year: Math.floor(day / 10), phase: "cool", value: -0.8 },
  teleconnection: 0.5,
  precipFactor: 0.84,
  effect: "dry",
});
const measure = (events: readonly Event[], from = 50, to = 150) =>
  profileOscillation(events, {
    from,
    to,
    clock,
    yearOf,
    population: [
      { tick: from, livingPeople: 10 },
      { tick: to, livingPeople: 8 },
    ],
  });

describe("métrica pura de oscilación", () => {
  it("separa años absolutos, conserva sequía citada del año anterior y no atribuye las muertes", () => {
    const famine = event(3, 110, "famine.began", { oscillation: yearOf(0), state: "scarcity" });
    const out = measure([
      event(1, 50, "weather.drought"), // creación excluida
      event(2, 60, "weather.drought", yearOf(0)),
      famine,
      event(4, 130, "body.died", { cause: "starvation" }),
      event(5, 140, "body.died", { cause: "thirst" }),
      event(6, 151, "weather.flood"), // futuro excluido
    ]);
    expect(out.rows.map((r) => [r.year, r.observedDays, r.basin])).toEqual([
      [0, 5, "basin-1"],
      [1, 5, "basin-1"],
    ]);
    expect(out.rows[0]?.weather).toHaveLength(1);
    expect(out.rows[1]?.hunger[0]).toMatchObject({ tick: 110, data: famine.data, causes: [cause] });
    expect(out.rows[1]?.starvationDeaths.map((e) => e.tick)).toEqual([130]);
    expect(out.populationExposure).toBe("snapshots_only_not_person_days");
    expect(out.attribution).toBe("temporal_context_only_explicit_causes_preserved");
    expect(out.rows[0]?.populationSnapshots).toEqual([{ tick: 50, livingPeople: 10 }]);
  });
  it("mantiene factores de años neutros aunque no haya eventos y distingue mapa sin cuenca", () => {
    const out = profileOscillation([], {
      from: 0,
      to: 90,
      clock,
      yearOf: () => ({ ...yearOf(0), effect: "none", precipFactor: 1.02 }),
      population: [],
    });
    expect(out.rows[0]?.oscillation?.precipFactor).toBe(1.02);
    expect(
      profileOscillation([], { from: 0, to: 90, clock, yearOf: () => undefined, population: [] })
        .rows[0]?.basin,
    ).toBeNull();
  });
  it("asigna eventos en el límite al año nuevo e incluye el tick final sin inventar exposición", () => {
    const out = measure([event(1, 100, "weather.flood")], 90, 100);
    expect(out.rows.map((r) => r.observedDays)).toEqual([1, 0]);
    expect(out.rows[1]?.weather[0]?.tick).toBe(100);
  });
  it("ordena una copia estable de los eventos y conserva solo el intervalo observado", () => {
    const events = [event(2, 60, "famine.ended"), event(1, 60, "famine.eased")];
    expect(measure(events).rows[0]?.hunger.map((e) => e.id)).toEqual([
      makeId("event", 1),
      makeId("event", 2),
    ]);
    expect(events[0]?.id).toBe(makeId("event", 2));
    expect(measure([], 50, 50).rows[0]?.observedDays).toBe(0);
  });
  it.each([NaN, Infinity, -1, 1.5])("rechaza intervalo inválido %s", (to) => {
    expect(() => measure([], 0, to)).toThrow(RangeError);
  });
});
