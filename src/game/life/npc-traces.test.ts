import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  type EntityBase,
  holderAccount,
  loadContent,
  makeId,
  type PlaceId,
  type PlaceRef,
  Rng,
} from "../../core/index.ts";
import {
  ENTITY,
  hexPath,
  LOCATION,
  PERSON,
  PLACE,
  type ProcessContext,
  type ProcessResult,
  WorldTruth,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { NPC_DECISION } from "./decide.ts";
import { Life } from "./life.ts";
import {
  CAMP_HOURS,
  LOAD_DROPPED_EVENT,
  LOAD_FOUND_EVENT,
  LOAD_RECLAIMED_EVENT,
  LOAD_ROTTED_EVENT,
  NPC_DROPS,
  NPC_TRACES,
  NPC_TRAIL,
  npcTracesProcess,
  roadAccount,
  TRACE_SEEN_EVENT,
  TRAIL_KEEP_HOURS,
  traceKind,
} from "./npc-traces.ts";
import { NPC_JOURNEY } from "./npc-verbs.ts";
import { living } from "./world.ts";

const HOUR = 3600;
const me = makeId("agent", 1);
const other = makeId("agent", 2);
const player = makeId("agent", 99);
const site = { kind: "place", place: "place:1" as PlaceId } satisfies PlaceRef;

function world(opts: {
  trail?: { from: number; last: number };
  otherHex?: number;
  trip?: boolean;
}) {
  const truth = new WorldTruth();
  const base = (id: AgentId): EntityBase => ({
    id,
    originEventId: makeId("event", 1),
    createdAt: 0,
  });
  for (const id of [me, other]) truth.set(ENTITY, id, base(id));
  truth.set(LOCATION, me, { hex: 5 });
  truth.set(LOCATION, other, { hex: opts.otherHex ?? 6 });
  if (opts.trip !== false) {
    truth.set(NPC_JOURNEY, me, { place: "place:7", since: 100, decision: "d" });
  }
  if (opts.trail) truth.set(NPC_TRAIL, other, { steps: [{ hex: 5, ...opts.trail }] });
  return truth;
}

function run(truth: WorldTruth, now: number, who: AgentId = me, seed = 1): ProcessResult {
  return npcTracesProcess({ player, placeOf: () => site }).run({
    now,
    window: HOUR,
    windowIndex: 1,
    scope: who,
    resolution: "local",
    phase: "perceive",
    truth,
    ledger: undefined,
    rng: Rng.root(seed),
    item: undefined,
    recent: [],
    newId() {
      throw new Error("no crea entidades");
    },
  } as unknown as ProcessContext);
}

function apply(truth: WorldTruth, out: ProcessResult) {
  for (const c of out.changes ?? []) {
    if (c.op === "delete") truth.deleteRaw(c.table, c.id);
    else if (c.op === "set") truth.setRaw(c.table, c.id, c.value);
  }
}

/** Una semilla donde la tirada de notar sale (o no), para fijar el caso. */
function seedWhere(notice: boolean): number {
  for (let s = 1; s < 200; s++) {
    const t = world({ trail: { from: 0, last: 0 } });
    const out = run(t, 10 * HOUR, me, s);
    if ((out.events?.length ?? 0) > 0 === notice) return s;
  }
  throw new Error("sin semilla");
}

describe("life.npc_traces", () => {
  it("quien viaja deja su paso: tramo continuo por hex, y lo viejo se olvida", () => {
    const truth = world({});
    apply(truth, run(truth, 1000));
    apply(truth, run(truth, 1000 + HOUR));
    expect(truth.get(NPC_TRAIL, me)?.steps).toEqual([{ hex: 5, from: 1000, last: 1000 + HOUR }]);
    truth.set(LOCATION, me, { hex: 6 });
    apply(truth, run(truth, 1000 + 2 * HOUR));
    expect(truth.get(NPC_TRAIL, me)?.steps).toHaveLength(2);
    apply(truth, run(truth, 1000 + (TRAIL_KEEP_HOURS + 5) * HOUR));
    expect(truth.get(NPC_TRAIL, me)?.steps.map((s) => s.hex)).toEqual([6]);
  });

  it("quien pasó y ya no está se nota como creencia, sin saber quién y con la edad estimada", () => {
    const seed = seedWhere(true);
    const truth = world({ trail: { from: 0, last: 0 } });
    const out = run(truth, 10 * HOUR, me, seed);
    expect(out.events).toHaveLength(1);
    expect(out.events?.[0]).toMatchObject({
      kind: TRACE_SEEN_EVENT,
      actors: [me],
      data: { hex: 5, trace: "footprints" },
    });
    apply(truth, out);
    const book = truth.get(NPC_TRACES, me);
    expect(book?.seen).toHaveLength(1);
    expect(book?.seen[0]).not.toHaveProperty("who");
    expect(JSON.stringify(book)).not.toContain(other);
    expect(book?.seen[0]?.estAgeHours).toBeGreaterThanOrEqual(1);
    expect(book?.seen[0]?.estAgeHours).not.toBe(0);
    // Una sola mirada por rastro.
    expect(run(truth, 11 * HOUR, me, seed).events ?? []).toEqual([]);
  });

  it("mirar y no notar también cuenta como mirada; sin rastro de otro no hay nada", () => {
    const seed = seedWhere(false);
    const truth = world({ trail: { from: 0, last: 0 } });
    const out = run(truth, 10 * HOUR, me, seed);
    expect(out.events ?? []).toEqual([]);
    apply(truth, out);
    expect(truth.get(NPC_TRACES, me)?.looked).toEqual(["5:0"]);
    expect(truth.get(NPC_TRACES, me)?.seen).toEqual([]);
    const none = world({});
    apply(none, run(none, 10 * HOUR));
    expect(none.get(NPC_TRACES, me)).toBeUndefined();
  });

  it("quien sigue ahí es un encuentro, no un rastro; lo recién pasado tampoco", () => {
    const here = world({ trail: { from: 0, last: 9 * HOUR }, otherHex: 5 });
    expect(run(here, 10 * HOUR).events ?? []).toEqual([]);
    const fresh = world({ trail: { from: 9 * HOUR, last: 9 * HOUR + 1800 } });
    expect(run(fresh, 10 * HOUR).events ?? []).toEqual([]);
  });

  it("la noche en un hex deja resto de fogata", () => {
    expect(traceKind({ hex: 5, from: 0, last: CAMP_HOURS * HOUR })).toBe("campfire");
    expect(traceKind({ hex: 5, from: 0, last: HOUR })).toBe("footprints");
  });

  it("sin viaje la libreta se limpia, el personaje no deja ni nota, y es determinista", () => {
    const truth = world({ trail: { from: 0, last: 0 } });
    truth.set(NPC_TRACES, me, { since: 100, looked: [], seen: [] });
    truth.deleteRaw(NPC_JOURNEY.name, me);
    apply(truth, run(truth, 10 * HOUR));
    expect(truth.get(NPC_TRACES, me)).toBeUndefined();
    expect(run(world({ trail: { from: 0, last: 0 } }), 10 * HOUR, player)).toEqual({});
    const seed = seedWhere(true);
    const a = run(world({ trail: { from: 0, last: 0 } }), 10 * HOUR, me, seed);
    const b = run(world({ trail: { from: 0, last: 0 } }), 10 * HOUR, me, seed);
    expect(a).toEqual(b);
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

describe("en una vida con el proceso encendido", () => {
  it("el viajero deja su rastro en el camino, determinista", () => {
    const all = loadContent(GAME_CONTENT_KINDS, sources("content"));
    const trail = () => {
      const life = Life.create(7, all, {
        npcVerbs: ["move"],
        npcJourneyDays: 6,
        npcTransit: true,
        npcEncounters: true,
        npcTraces: true,
      });
      const w = life.world;
      const npc = living(w.truth).find(
        (x) =>
          x !== life.player && (w.truth.get(PERSON, x)?.born ?? 0) < life.now - 20 * 365 * 86_400,
      ) as AgentId;
      const place = w.truth.ids(PLACE)[0] as string;
      const hexes = (w.truth.get(PLACE, place as never)?.hexes ?? []) as number[];
      let from = hexes[0] as number;
      for (let i = 0; i < 4; i++) {
        from =
          (w.map.neighbors[from] ?? []).find(
            (n) => !hexes.includes(n) && hexPath(w.map, n, hexes[0] as number).length > i,
          ) ?? from;
      }
      w.truth.set(LOCATION, npc, { hex: from });
      w.truth.set(NPC_DECISION, npc, {
        at: life.now,
        id: `move:${place}+toward:agent:99`,
        verb: "move",
        target: place,
        utility: 1,
        options: 2,
      } as never);
      life.advanceTo(life.now + 4 * 3600);
      return JSON.stringify(w.truth.get(NPC_TRAIL, npc));
    };
    const a = trail();
    expect(a).toContain('"hex"');
    expect(trail()).toBe(a);
  }, 240_000);
});

describe("carga caída (npc-b2b4b2)", () => {
  const load = { unit: "good:grain", name: "grano" };
  const pocket = holderAccount(me);
  const pocketOther = holderAccount(other);

  function bank(balances: Record<string, number>) {
    const m = new Map(Object.entries(balances));
    return {
      m,
      balance: (a: string) => m.get(a) ?? 0,
      holdings: () => [],
      total: () => 0,
    };
  }
  function runLoad(
    truth: WorldTruth,
    ledger: ReturnType<typeof bank>,
    now: number,
    who: AgentId,
    seed: number,
  ): ProcessResult {
    return npcTracesProcess({ player, placeOf: () => site, load }).run({
      now,
      window: HOUR,
      windowIndex: 1,
      scope: who,
      resolution: "local",
      phase: "perceive",
      truth,
      ledger,
      rng: Rng.root(seed),
      item: undefined,
      recent: [],
      newId() {
        throw new Error("no crea entidades");
      },
    } as unknown as ProcessContext);
  }
  function post(ledger: ReturnType<typeof bank>, out: ProcessResult) {
    for (const p of out.postings ?? []) {
      for (const t of p.transfers) {
        ledger.m.set(t.from, (ledger.m.get(t.from) ?? 0) - t.amount);
        ledger.m.set(t.to, (ledger.m.get(t.to) ?? 0) + t.amount);
      }
    }
  }
  const total = (l: ReturnType<typeof bank>) => [...l.m.values()].reduce((a, b) => a + b, 0);

  function dropSeed(): number {
    for (let s = 1; s < 2000; s++) {
      const out = runLoad(world({}), bank({ [pocket]: 1000 }), 10 * HOUR, me, s);
      if ((out.postings?.length ?? 0) > 0) return s;
    }
    throw new Error("sin semilla");
  }

  it("quien carga puede perder parte: sale del bolsillo, queda en la celda del hex y se registra", () => {
    const seed = dropSeed();
    const truth = world({});
    const ledger = bank({ [pocket]: 1000 });
    const out = runLoad(truth, ledger, 10 * HOUR, me, seed);
    expect(out.events?.some((e) => e.kind === LOAD_DROPPED_EVENT)).toBe(true);
    post(ledger, out);
    apply(truth, out);
    expect(ledger.balance(pocket)).toBe(850);
    expect(ledger.balance(roadAccount(5))).toBe(150);
    expect(total(ledger)).toBe(1000);
    expect(truth.get(NPC_DROPS, me)?.lots).toEqual([
      { hex: 5, unit: "good:grain", name: "grano", grams: 150, at: 10 * HOUR },
    ]);
    // Determinista.
    expect(runLoad(world({}), bank({ [pocket]: 1000 }), 10 * HOUR, me, seed)).toEqual(out);
  });

  it("sin carga o sin la opción no se pierde nada", () => {
    for (let s = 1; s < 300; s++) {
      expect(runLoad(world({}), bank({}), 10 * HOUR, me, s).postings ?? []).toEqual([]);
      expect(run(world({}), 10 * HOUR, me, s).postings ?? []).toEqual([]);
    }
  });

  it("quien pasa lo ve como creencia y puede recogerlo: conservación y una sola vez", () => {
    const lot = { hex: 5, unit: "good:grain", name: "grano", grams: 150, at: 0 };
    const setup = () => {
      const truth = world({});
      truth.set(NPC_DROPS, other, { lots: [lot] });
      const ledger = bank({ [roadAccount(5)]: 150, [pocketOther]: -150 });
      return { truth, ledger };
    };
    let seed = 0;
    for (let s = 1; s < 500 && seed === 0; s++) {
      const { truth, ledger } = setup();
      const out = runLoad(truth, ledger, 10 * HOUR, me, s);
      if (out.events?.some((e) => e.kind === LOAD_FOUND_EVENT)) seed = s;
    }
    expect(seed).toBeGreaterThan(0);
    const { truth, ledger } = setup();
    const out = runLoad(truth, ledger, 10 * HOUR, me, seed);
    post(ledger, out);
    apply(truth, out);
    expect(ledger.balance(pocket)).toBe(150);
    expect(ledger.balance(roadAccount(5))).toBe(0);
    expect(total(ledger)).toBe(0);
    expect(truth.get(NPC_DROPS, other)).toBeUndefined();
    expect(truth.get(NPC_TRACES, me)?.seen[0]).toMatchObject({ kind: "dropped_load", hex: 5 });
    expect(JSON.stringify(truth.get(NPC_TRACES, me))).not.toContain(other);
    // Ya no hay nada que recoger.
    const again = runLoad(truth, ledger, 11 * HOUR, me, seed);
    expect((again.postings ?? []).filter((p) => p.transfers.some((t) => t.to === pocket))).toEqual(
      [],
    );
  });

  it("el que dejó la carga no la recoge", () => {
    const truth = world({});
    truth.set(NPC_DROPS, me, {
      lots: [{ hex: 5, unit: "good:grain", name: "grano", grams: 150, at: 0 }],
    });
    for (let s = 1; s < 100; s++) {
      const out = runLoad(truth, bank({ [roadAccount(5)]: 150 }), 10 * HOUR, me, s);
      expect((out.postings ?? []).filter((p) => p.transfers.some((t) => t.to === pocket))).toEqual(
        [],
      );
    }
  });
  it("lo caído que nadie recoge se pudre: sale al sumidero, el registro caduca y se conserva", () => {
    const rotLoad = { ...load, rotAfterHours: 48 };
    const runRot = (truth: WorldTruth, ledger: ReturnType<typeof bank>, now: number, who = other) =>
      npcTracesProcess({ player, placeOf: () => site, load: rotLoad }).run({
        now,
        window: HOUR,
        windowIndex: 1,
        scope: who,
        resolution: "local",
        phase: "perceive",
        truth,
        ledger,
        rng: Rng.root(3),
        item: undefined,
        recent: [],
        newId() {
          throw new Error("no crea entidades");
        },
      } as unknown as ProcessContext);
    const setup = () => {
      const truth = world({ trip: false });
      truth.set(NPC_DROPS, other, {
        lots: [
          { hex: 5, unit: "good:grain", name: "grano", grams: 150, at: 0 },
          { hex: 5, unit: "good:grain", name: "grano", grams: 40, at: 40 * HOUR },
        ],
      });
      return { truth, ledger: bank({ [roadAccount(5)]: 190, [pocketOther]: -190 }) };
    };
    // Antes de tiempo no pasa nada.
    const early = setup();
    expect(runRot(early.truth, early.ledger, 47 * HOUR)).toEqual({});
    const { truth, ledger } = setup();
    const out = runRot(truth, ledger, 50 * HOUR);
    expect(out.events?.map((e) => e.kind)).toEqual([LOAD_ROTTED_EVENT]);
    post(ledger, out);
    apply(truth, out);
    expect(ledger.balance(roadAccount(5))).toBe(40);
    expect(total(ledger)).toBe(0);
    expect(truth.get(NPC_DROPS, other)?.lots).toHaveLength(1);
    // Determinista, y el segundo lote también caduca a su tiempo.
    expect(runRot(setup().truth, setup().ledger, 50 * HOUR)).toEqual(out);
    const later = runRot(truth, ledger, 90 * HOUR);
    post(ledger, later);
    apply(truth, later);
    expect(truth.get(NPC_DROPS, other)).toBeUndefined();
    expect(ledger.balance(roadAccount(5))).toBe(0);
    // Sin la opción no caduca nunca.
    const off = setup();
    expect(runLoad(off.truth, off.ledger, 500 * HOUR, other, 1).events ?? []).toEqual([]);
  });
});

describe("el dueño que vuelve reclama lo caído (npc-b2b4b3b)", () => {
  const load = { unit: "good:grain", name: "grano", reclaim: true };
  const plain = { unit: "good:grain", name: "grano" };
  const pocket = holderAccount(me);
  const pocketOther = holderAccount(other);
  const lot = { hex: 5, unit: "good:grain", name: "grano", grams: 150, at: 0 };

  function bank(balances: Record<string, number>) {
    const m = new Map(Object.entries(balances));
    return { m, balance: (a: string) => m.get(a) ?? 0, holdings: () => [], total: () => 0 };
  }
  function runAs(
    truth: WorldTruth,
    ledger: ReturnType<typeof bank>,
    who: AgentId,
    seed: number,
    l: { unit: string; name: string; reclaim?: boolean } = load,
  ): ProcessResult {
    return npcTracesProcess({ player, placeOf: () => site, load: l }).run({
      now: 10 * HOUR,
      window: HOUR,
      windowIndex: 1,
      scope: who,
      resolution: "local",
      phase: "perceive",
      truth,
      ledger,
      rng: Rng.root(seed),
      item: undefined,
      recent: [],
      newId() {
        throw new Error("no crea entidades");
      },
    } as unknown as ProcessContext);
  }
  function post(ledger: ReturnType<typeof bank>, out: ProcessResult) {
    for (const p of out.postings ?? []) {
      for (const t of p.transfers) {
        ledger.m.set(t.from, (ledger.m.get(t.from) ?? 0) - t.amount);
        ledger.m.set(t.to, (ledger.m.get(t.to) ?? 0) + t.amount);
      }
    }
  }
  const total = (l: ReturnType<typeof bank>) => [...l.m.values()].reduce((a, b) => a + b, 0);
  // `me` está en el hex 5, donde cayó su propia carga.
  const setup = () => {
    const truth = world({ trip: false });
    truth.set(NPC_DROPS, me, { lots: [lot] });
    return { truth, ledger: bank({ [roadAccount(5)]: 150, [pocket]: -150 }) };
  };

  it("el dueño en el hex la recupera: conserva gramos, borra el registro, causa en su registro", () => {
    let seed = 0;
    for (let s = 1; s < 200 && seed === 0; s++) {
      const { truth, ledger } = setup();
      if (runAs(truth, ledger, me, s).events?.length) seed = s;
    }
    expect(seed).toBeGreaterThan(0);
    const { truth, ledger } = setup();
    const out = runAs(truth, ledger, me, seed);
    expect(out.events?.map((e) => e.kind)).toEqual([LOAD_RECLAIMED_EVENT]);
    expect(out.events?.[0]?.causes).toEqual([{ kind: "state", entity: me, key: "life.npc_drops" }]);
    post(ledger, out);
    apply(truth, out);
    expect(ledger.balance(pocket)).toBe(0);
    expect(ledger.balance(roadAccount(5))).toBe(0);
    expect(total(ledger)).toBe(0);
    expect(truth.get(NPC_DROPS, me)).toBeUndefined();
    // Determinista.
    const again = setup();
    expect(runAs(again.truth, again.ledger, me, seed)).toEqual(out);
  });

  it("sin la opción no reclama; lejos del hex tampoco", () => {
    for (let s = 1; s < 100; s++) {
      const a = setup();
      const off = runAs(a.truth, a.ledger, me, s, plain);
      expect((off.events ?? []).some((e) => e.kind === LOAD_RECLAIMED_EVENT)).toBe(false);
      const b = setup();
      b.truth.set(LOCATION, me, { hex: 9 });
      const far = runAs(b.truth, b.ledger, me, s);
      expect((far.events ?? []).some((e) => e.kind === LOAD_RECLAIMED_EVENT)).toBe(false);
    }
  });

  it("con el dueño en el hex, quien pasa no se lo lleva; sin la opción el hallazgo sigue igual", () => {
    const found = (l: typeof load | typeof plain, s: number) => {
      const truth = world({ trip: true });
      truth.set(NPC_DROPS, other, { lots: [lot] });
      truth.set(LOCATION, other, { hex: 5 });
      const out = runAs(truth, bank({ [roadAccount(5)]: 150, [pocketOther]: -150 }), me, s, l);
      return (out.events ?? []).some((e) => e.kind === LOAD_FOUND_EVENT);
    };
    for (let s = 1; s < 200; s++) expect(found(load, s)).toBe(false);
    expect(Array.from({ length: 200 }, (_, i) => found(plain, i + 1)).some(Boolean)).toBe(true);
  });
});
