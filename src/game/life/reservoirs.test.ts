import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentId, ContentSource, EntityRef, EventId } from "../../core/index.ts";
import { loadContent, Rng } from "../../core/index.ts";
import {
  BODY_STATE,
  checkInvariants,
  ECOLOGY,
  ENTITY,
  hashState,
  INFECTION,
  LOCATION,
  type LocalMap,
  PATHOGEN,
  type PathogenDef,
  PERSON,
  type ProcessContext,
  WorldTruth,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { createLife } from "./create.ts";
import { exposureProcess } from "./exposure.ts";
import {
  RESERVOIR,
  type ReservoirHost,
  reservoirContact,
  reservoirProcess,
  reservoirSeeds,
} from "./reservoirs.ts";

const clock = { day: 86400, year: 86400 * 360, moons: [] };
const tularemia: PathogenDef = {
  id: "tularemia",
  routes: { contact: 1 },
  incubationHours: 72,
  courseHours: 240,
  contagiousFrom: 0.5,
  transmissibility: 1,
  lethality: 0,
  immunity: "lifelong",
  immunityHours: 0,
};
const eco = "settlement:1" as EntityRef;
const a = "agent:1" as AgentId;
const b = "agent:2" as AgentId;
const place = { kind: "cell", cell: "cell:1" } as never;
// Hex 0 es monte, hex 1 campo abierto.
const map = { forest: [true, false] } as unknown as LocalMap;

const hares: ReservoirHost = {
  id: "hare-tularemia",
  def: tularemia,
  kind: "animal",
  lineage: "hare",
  criticalSize: 100,
  wildContact: 1,
};

function world(hareCount: number): WorldTruth {
  const t = new WorldTruth();
  t.set(ENTITY, eco, { id: eco, originEventId: "event:1" as EventId, createdAt: 0 } as never);
  t.set(ECOLOGY, eco, {
    cell: { productivity: 1, shelter: 0.5, populations: [{ lineage: "hare", count: hareCount }] },
    forest: {},
    fireHazard: 0,
    day: 0,
    yearDays: 0,
  } as never);
  for (const id of [a, b]) {
    t.set(
      ENTITY,
      id as EntityRef,
      { id, originEventId: "event:1" as EventId, createdAt: 0 } as never,
    );
    t.set(PERSON, id as EntityRef, { household: `household:${id}` } as never);
    t.set(BODY_STATE, id as EntityRef, { muscle: 0.5 } as never);
  }
  t.set(LOCATION, a as never, { hex: 0 });
  t.set(LOCATION, b as never, { hex: 1 });
  return t;
}

function ctx(truth: WorldTruth, now: number, window = clock.day): ProcessContext {
  let n = 0;
  return {
    now,
    window,
    truth,
    rng: Rng.root(1),
    newId: (k: string) => `${k}:~${n++}`,
  } as unknown as ProcessContext;
}

function apply(t: WorldTruth, out: ReturnType<ReturnType<typeof reservoirProcess>["run"]>) {
  for (const c of out.changes ?? []) {
    if (c.op === "set") t.setRaw(c.table, c.id as EntityRef, c.value);
  }
}

describe("life.reservoir", () => {
  it("sin huéspedes o sin ecología no hace nada", () => {
    expect(reservoirProcess({ hosts: [], dayTicks: clock.day }).run(ctx(world(500), 0))).toEqual(
      {},
    );
    const bare = new WorldTruth();
    expect(reservoirProcess({ hosts: [hares], dayTicks: clock.day }).run(ctx(bare, 0))).toEqual({});
  });

  it("la prevalencia sigue a la población real: se sostiene sobre el tamaño crítico y se apaga bajo él", () => {
    const p = reservoirProcess({ hosts: [hares], dayTicks: clock.day });
    const t = world(500);
    for (let d = 0; d < 60; d++) apply(t, p.run(ctx(t, d * clock.day)));
    const high = t.get(RESERVOIR, eco)?.hosts[0];
    expect(high?.population).toBe(500);
    expect(high?.prevalence).toBeGreaterThan(0.2);
    // Una cacería o una helada dejan pocas liebres: el reservorio se apaga solo.
    t.set(ECOLOGY, eco, {
      ...(t.get(ECOLOGY, eco) as object),
      cell: { productivity: 1, shelter: 0.5, populations: [{ lineage: "hare", count: 20 }] },
    } as never);
    for (let d = 60; d < 200; d++) apply(t, p.run(ctx(t, d * clock.day)));
    expect(t.get(RESERVOIR, eco)?.hosts[0]?.prevalence).toBe(0);
  });

  it("no toca las poblaciones de la ecología (no inventa ni quita animales)", () => {
    const p = reservoirProcess({ hosts: [hares], dayTicks: clock.day });
    const t = world(500);
    const before = JSON.stringify(t.get(ECOLOGY, eco));
    for (let d = 0; d < 30; d++) {
      const out = p.run(ctx(t, d * clock.day));
      expect(out.changes?.every((c) => c.table === RESERVOIR.name) ?? true).toBe(true);
      apply(t, out);
    }
    expect(JSON.stringify(t.get(ECOLOGY, eco))).toBe(before);
  });

  it("el agua quieta usa su volumen fijo", () => {
    const marsh: ReservoirHost = {
      id: "marsh",
      def: tularemia,
      kind: "water",
      volume: 300,
      criticalSize: 100,
      wildContact: 1,
      hexes: [1],
    };
    const p = reservoirProcess({ hosts: [marsh], dayTicks: clock.day });
    const t = world(0);
    for (let d = 0; d < 40; d++) apply(t, p.run(ctx(t, d * clock.day)));
    expect(t.get(RESERVOIR, eco)?.hosts[0]?.prevalence).toBeGreaterThan(0.1);
    expect(reservoirContact(marsh, t, b as EntityRef, map)).toBe(1);
    expect(reservoirContact(marsh, t, a as EntityRef, map)).toBe(0);
  });
});

describe("reservoirSeeds", () => {
  const active = (): WorldTruth => {
    const t = world(500);
    t.set(RESERVOIR, eco, { hosts: [{ id: hares.id, population: 500, prevalence: 1 }] });
    return t;
  };

  it("solo tira quien está en el monte; el reservorio es la causa", () => {
    const t = active();
    expect(reservoirContact(hares, t, a as EntityRef, map)).toBe(1);
    expect(reservoirContact(hares, t, b as EntityRef, map)).toBe(0);
    // Adentro de una casa en el monte no hay contacto (salvo comensales).
    t.set(LOCATION, b as never, { hex: 0, space: "house:1" as never });
    expect(reservoirContact(hares, t, b as EntityRef, map)).toBe(0);
    expect(reservoirContact({ ...hares, homeContact: 0.4 }, t, b as EntityRef, map)).toBe(0.4);
    const seeds = reservoirSeeds(Rng.root(1), active(), 0, [hares], map);
    expect(seeds.map((s) => s.carrier)).toEqual([a]);
    expect(seeds[0]?.causes).toEqual([
      { kind: "state", entity: eco, key: "reservoir:hare-tularemia" },
    ]);
    expect(seeds[0]?.perCarrier).toBe(true);
  });

  it("inmunes, ya infectados, apagado o sin huéspedes: nada", () => {
    const t = active();
    t.set(INFECTION, a as never, {
      infections: [],
      immunities: [{ pathogen: "tularemia", until: null }],
      ill: [],
    });
    expect(reservoirSeeds(Rng.root(1), t, 0, [hares], map)).toEqual([]);
    const t2 = active();
    t2.set(INFECTION, a as never, {
      infections: [{ pathogen: "tularemia", exposedAt: 0, dose: 1, fatal: false, cause: null }],
      immunities: [],
      ill: [],
    });
    expect(reservoirSeeds(Rng.root(1), t2, 0, [hares], map)).toEqual([]);
    const off = world(500);
    off.set(RESERVOIR, eco, { hosts: [{ id: hares.id, population: 500, prevalence: 0 }] });
    expect(reservoirSeeds(Rng.root(1), off, 0, [hares], map)).toEqual([]);
    expect(reservoirSeeds(Rng.root(1), active(), 0, [], map)).toEqual([]);
  });

  it("es determinista y la tirada depende del día", () => {
    const low: ReservoirHost = { ...hares, wildContact: 0.3 };
    const t = world(500);
    t.set(RESERVOIR, eco, { hosts: [{ id: hares.id, population: 500, prevalence: 0.5 }] });
    const days = Array.from(
      { length: 40 },
      (_, d) => reservoirSeeds(Rng.root(9), t, d * clock.day, [low], map).length,
    );
    const again = Array.from(
      { length: 40 },
      (_, d) => reservoirSeeds(Rng.root(9), t, d * clock.day, [low], map).length,
    );
    expect(days).toEqual(again);
    expect(days.some((n) => n === 0)).toBe(true);
    expect(days.some((n) => n === 1)).toBe(true);
  });

  it("por arrivals, life.exposure introduce el patógeno con el reservorio como causa", () => {
    const t = active();
    const p = exposureProcess({
      clock,
      placeOf: () => place,
      arrivalReads: [RESERVOIR.name],
      arrivals: (truth, now) => reservoirSeeds(Rng.root(1), truth, now, [hares], map),
    });
    expect(p.reads).toContain(RESERVOIR.name);
    const out = p.run(ctx(t, 0));
    expect(out.events?.[0]?.kind).toBe("body.pathogen_introduced");
    expect(out.events?.[0]?.actors).toEqual([a]);
    expect(out.events?.[0]?.causes).toEqual([
      { kind: "state", entity: eco, key: "reservoir:hare-tularemia" },
    ]);
    expect(out.changes?.some((c) => c.table === PATHOGEN.name)).toBe(true);
    expect(p.run(ctx(active(), 0))).toEqual(out);
  });
});

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}

describe("reservorios en la vida (opt-in)", () => {
  it("apagado no agrega el proceso; encendido corre, es determinista y cumple invariantes", () => {
    const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
    const off = createLife(7, content, { frequency: 8 }).world;
    expect(off.reservoirs).toBeUndefined();
    expect(off.truth.ids(RESERVOIR)).toEqual([]);
    // El agua quieta no depende de que el clima de la semilla tenga liebres; la casa la toca
    // (`homeContact`) para que haya derrames en pocos días.
    const host: ReservoirHost = {
      id: "pond",
      def: tularemia,
      kind: "water",
      volume: 1000,
      criticalSize: 1,
      wildContact: 1,
      homeContact: 1,
      hexes: [],
    };
    const run = () => {
      const w = createLife(7, content, { frequency: 8, reservoirs: [host] }).world;
      w.scheduler.advanceTo(w.scheduler.now + w.clock.day * 6);
      return w;
    };
    const w = run();
    const [ecoId] = w.truth.ids(ECOLOGY);
    expect(ecoId).toBeDefined();
    const row = w.truth.get(RESERVOIR, ecoId as EntityRef)?.hosts[0];
    expect(row?.population).toBe(1000);
    expect(row?.prevalence).toBeGreaterThan(0);
    const introduced = w.log
      .all()
      .filter(
        (e) =>
          e.kind === "body.pathogen_introduced" &&
          (e.data as { pathogen?: string }).pathogen === "tularemia",
      );
    expect(introduced.length).toBeGreaterThan(0);
    for (const e of introduced) {
      expect(e.causes).toEqual([{ kind: "state", entity: ecoId, key: "reservoir:pond" }]);
    }
    expect(checkInvariants({ truth: w.truth, log: w.log })).toEqual([]);
    const state = (x: typeof w) => ({
      truth: x.truth,
      log: x.log,
      ledger: x.ledger,
      ids: x.ids.state(),
      scheduler: x.scheduler.state(),
    });
    expect(hashState(state(run()))).toEqual(hashState(state(w)));
  }, 600_000);
});
