import { describe, expect, it } from "vitest";
import { Rng } from "../../core/index.ts";
import type { PathogenDef, Shared } from "./disease.ts";
import {
  carrierArrival,
  crossImmunity,
  isolationShock,
  mutate,
  naiveLethality,
  pathogenLineage,
  type Reservoir,
  reservoirSpill,
  reservoirStep,
} from "./epidemic.ts";

const plague: PathogenDef = {
  id: "plague",
  routes: { air: 0.8, contact: 0.3 },
  incubationHours: 48,
  courseHours: 120,
  contagiousFrom: 0.5,
  transmissibility: 0.05,
  lethality: 0.2,
  immunity: "lifelong",
  immunityHours: 0,
};

const market: Shared = { hours: 4, closeness: 0.6, ventilation: 0.2, waterDirt: 0, touch: 0.5 };

describe("portadores", () => {
  it("el que llega contagioso deja dosis; el que murió en camino no", () => {
    const c = { pathogen: plague, hoursSinceExposure: 10, fatal: false, from: "puerto", party: 3 };
    const ok = carrierArrival(c, 50, market);
    expect(ok.diedOnRoad).toBe(false);
    expect(ok.dose).toBeGreaterThan(0);
    const dead = carrierArrival({ ...c, fatal: true }, 400, market);
    expect(dead).toEqual({ diedOnRoad: true, shedding: 0, dose: 0 });
  });
  it("llegar antes de ser contagioso no deja dosis", () => {
    const c = { pathogen: plague, hoursSinceExposure: 0, fatal: false, from: "x", party: 1 };
    expect(carrierArrival(c, 5, market).dose).toBe(0);
  });
});

describe("reservorios", () => {
  const rats: Reservoir = {
    pathogen: "plague",
    kind: "animal",
    population: 500,
    prevalence: 0.2,
    criticalSize: 100,
  };
  it("sobre el tamaño crítico se sostiene; bajo él se apaga", () => {
    expect(reservoirStep(rats, 30).prevalence).toBeGreaterThan(0.1);
    let small = { ...rats, population: 20 };
    for (let i = 0; i < 10; i++) small = reservoirStep(small, 30);
    expect(small.prevalence).toBe(0);
  });
  it("derrama más con más contacto", () => {
    expect(reservoirSpill(rats, plague, 0.8, 1)).toBeGreaterThan(
      reservoirSpill(rats, plague, 0.1, 1),
    );
  });
});

describe("mutación", () => {
  it("es determinista y deja ancestro", () => {
    const a = mutate(plague, "plague-b", Rng.root(1).fork("m"));
    const b = mutate(plague, "plague-b", Rng.root(1).fork("m"));
    expect(a).toEqual(b);
    expect(a.ancestor).toBe("plague");
    expect(a.def.id).toBe("plague-b");
    expect(a.changes.length).toBeGreaterThan(0);
    expect(a.def.lethality).toBeLessThanOrEqual(1);
  });
  it("seeds distintos dan hijos distintos", () => {
    const a = mutate(plague, "x", Rng.root(1).fork("m"));
    const b = mutate(plague, "x", Rng.root(2).fork("m"));
    expect(a.def.transmissibility).not.toBe(b.def.transmissibility);
  });
  it("linaje de ancestros, sin ciclos", () => {
    const e = [
      { id: "c", ancestor: "b" },
      { id: "b", ancestor: "a" },
      { id: "a", ancestor: "c" },
    ];
    expect(pathogenLineage(e, "c")).toEqual(["c", "b", "a"]);
  });
});

describe("poblaciones aisladas", () => {
  it("sin historia la letalidad es mayor", () => {
    expect(naiveLethality(plague, 0)).toBeGreaterThan(plague.lethality);
    expect(naiveLethality(plague, 1)).toBeLessThan(plague.lethality);
  });
  it("la inmunidad a un ancestro protege parcialmente", () => {
    const hist = [{ pathogen: "plague", until: null }];
    expect(crossImmunity(["plague-b", "plague"], [], hist, 0)).toBe(0.5);
    expect(crossImmunity(["plague"], [], hist, 0)).toBe(1);
    expect(crossImmunity(["other"], [], hist, 0)).toBe(0);
  });
  it("el choque mata más a los aislados que a los expuestos", () => {
    const iso = isolationShock(plague, 2000, 20, 0, Rng.root(7).fork("s"));
    const seasoned = isolationShock(plague, 2000, 20, 0.9, Rng.root(7).fork("s"));
    expect(iso.deaths).toBeGreaterThan(seasoned.deaths);
    expect(iso).toEqual(isolationShock(plague, 2000, 20, 0, Rng.root(7).fork("s")));
  });
});
