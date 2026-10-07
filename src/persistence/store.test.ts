import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import { type AgentId, CanonError, IdAllocator, makeId } from "../core/index.ts";
import { DAY, HUT, resumeVillage, village } from "../sim/scheduler/village.fixture.ts";
import { checkInvariants, ENTITY, hashState, table } from "../sim/world/index.ts";
import { openSqlite, type SqlDriver } from "./driver.ts";
import { componentTable, FORMAT_VERSION, fieldExpr } from "./schema.ts";
import { type LifeState, LifeStore, PersistenceError } from "./store.ts";

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

function resume(seed: number, s: LifeState): Village {
  return resumeVillage(seed, { ...s, ids: new IdAllocator(s.ids) });
}

/** Lo que tiene que volver igual de un guardado (copiado: el registro y el diario crecen). */
function dump(s: LifeState) {
  return {
    rows: s.truth.rows(),
    events: [...s.log.all()],
    journal: [...s.ledger.journal()],
    balances: s.ledger.balances(),
    ids: s.ids,
    scheduler: s.scheduler,
  };
}

const opened: SqlDriver[] = [];
const dirs: string[] = [];

function memory(): SqlDriver {
  const db = openSqlite(":memory:");
  opened.push(db);
  return db;
}

afterEach(() => {
  for (const db of opened.splice(0)) db.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const seeds = fc.nat({ max: 0xffffffff });

describe("LifeStore", () => {
  it("guardar y cargar devuelve el mismo mundo, que sigue sano", () => {
    fc.assert(
      fc.property(seeds, fc.integer({ min: 0, max: 60 }), (seed, days) => {
        const w = village(seed);
        w.scheduler.advanceTo(days * DAY);
        const store = LifeStore.open(memory());
        store.save(stateOf(w));
        const back = store.load();
        expect(dump(back)).toEqual(dump(stateOf(w)));
        expect(checkInvariants(back)).toEqual([]);
      }),
      { numRuns: 15 },
    );
  });

  it("seguir desde lo guardado da lo mismo que no haber parado", () => {
    fc.assert(
      fc.property(
        seeds,
        fc.array(fc.integer({ min: 1, max: 20 }), { minLength: 1, maxLength: 5 }),
        (seed, legs) => {
          const total = legs.reduce((a, b) => a + b, 0) * DAY;
          const straight = village(seed);
          straight.scheduler.advanceTo(total);

          // Por tramos: cada turno se guarda (incremental) y se sigue desde lo cargado.
          const store = LifeStore.open(memory());
          let w = village(seed);
          let t = 0;
          for (const leg of legs) {
            t += leg * DAY;
            w.scheduler.advanceTo(t);
            store.save(stateOf(w));
            w = resume(seed, store.load());
          }
          expect(dump(stateOf(w))).toEqual(dump(stateOf(straight)));
        },
      ),
      { numRuns: 10 },
    );
  });

  it("en un archivo: se cierra, se abre y sigue", () => {
    const dir = mkdtempSync(join(tmpdir(), "rpg-life-"));
    dirs.push(dir);
    const path = join(dir, "vida.sqlite");
    const w = village(7);
    w.scheduler.advanceTo(30 * DAY);
    const db = openSqlite(path);
    LifeStore.open(db).save(stateOf(w));
    db.close();

    const again = openSqlite(path);
    opened.push(again);
    expect(again.get<{ journal_mode: string }>("PRAGMA journal_mode")?.journal_mode).toBe("wal");
    const store = LifeStore.open(again);
    expect(store.hasSave).toBe(true);
    expect(dump(store.load())).toEqual(dump(stateOf(w)));
  });

  it("solo escribe lo que cambió y borra lo que ya no está", () => {
    const w = village(3);
    w.scheduler.advanceTo(20 * DAY);
    const db = memory();
    const store = LifeStore.open(db);
    store.save(stateOf(w));
    const [first] = w.truth.ids(ENTITY);
    const before = store.componentHash(ENTITY.name, first as AgentId);
    expect(before).toMatch(/^[0-9a-f]{64}$/);

    const NOTE = table<{ text: string }>("note");
    w.truth.set(NOTE, first as AgentId, { text: "hola" });
    store.save(stateOf(w));
    expect(store.load().truth.get(NOTE, first as AgentId)).toEqual({ text: "hola" });
    expect(store.componentHash(ENTITY.name, first as AgentId)).toBe(before);

    w.truth.deleteRaw(NOTE.name, first as AgentId);
    store.save(stateOf(w));
    expect(store.componentHash(NOTE.name, first as AgentId)).toBeUndefined();
    expect(store.load().truth.tables()).not.toContain(NOTE.name);
  });

  it("un guardado que falla no deja nada a medias", () => {
    const w = village(5);
    w.scheduler.advanceTo(10 * DAY);
    const store = LifeStore.open(memory());
    store.save(stateOf(w));
    const saved = dump(store.load());

    w.scheduler.advanceTo(25 * DAY);
    const BAD = table<{ x: number }>("bad");
    w.truth.set(BAD, makeId("settlement", 1), { x: Number.NaN });
    expect(() => store.save(stateOf(w))).toThrow(CanonError);
    expect(dump(store.load())).toEqual(saved);

    // Arreglado, el siguiente guardado escribe todo lo pendiente.
    w.truth.deleteRaw(BAD.name, makeId("settlement", 1));
    store.save(stateOf(w));
    expect(dump(store.load())).toEqual(dump(stateOf(w)));
  });

  it("no acepta un registro más corto que lo guardado", () => {
    const w = village(9);
    w.scheduler.advanceTo(20 * DAY);
    const store = LifeStore.open(memory());
    store.save(stateOf(w));
    const fresh = village(9);
    expect(() => store.save(stateOf(fresh))).toThrow(PersistenceError);
  });

  it("los snapshots rehacen el mundo de ese tick", () => {
    fc.assert(
      fc.property(seeds, (seed) => {
        const w = village(seed);
        const store = LifeStore.open(memory());
        w.scheduler.advanceTo(10 * DAY);
        store.saveSnapshot(stateOf(w));
        const at10 = dump(stateOf(w));
        w.scheduler.advanceTo(25 * DAY);
        store.saveSnapshot(stateOf(w));
        w.scheduler.advanceTo(40 * DAY);
        store.save(stateOf(w));

        expect(store.snapshots()).toEqual([
          { tick: 10 * DAY, kind: "full" },
          { tick: 25 * DAY, kind: "full" },
        ]);
        const snap = store.loadSnapshot(10 * DAY);
        expect(dump(snap)).toEqual(at10);
        // Cada snapshot guarda el hash del estado de su tick: los checkpoints del replay.
        const checkpoints = store.checkpoints();
        expect(checkpoints.map((c) => c.tick)).toEqual([10 * DAY, 25 * DAY]);
        expect(checkpoints[0]?.hash).toEqual(hashState(snap));
        expect(checkInvariants(snap)).toEqual([]);
        // Desde el snapshot se llega al mismo presente.
        const again = resume(seed, snap);
        again.scheduler.advanceTo(40 * DAY);
        expect(dump(stateOf(again))).toEqual(dump(store.load()));
      }),
      { numRuns: 8 },
    );
  });

  it("un snapshot dañado no se carga", () => {
    const w = village(2);
    w.scheduler.advanceTo(5 * DAY);
    const db = memory();
    const store = LifeStore.open(db);
    store.saveSnapshot(stateOf(w));
    db.run("UPDATE snapshots SET hash = 'x'");
    expect(() => store.loadSnapshot(5 * DAY)).toThrow(/dañado/);
    expect(() => store.loadSnapshot(6 * DAY)).toThrow(PersistenceError);
  });

  it("las consultas del inspector coinciden con la verdad y el registro", () => {
    const w = village(11);
    w.scheduler.advanceTo(90 * DAY);
    const db = memory();
    const store = LifeStore.open(db, { indexes: { hut: ["owner"] } });
    store.save(stateOf(w));
    const plan = db.all<{ detail: string }>(
      `EXPLAIN QUERY PLAN SELECT id FROM ${componentTable(HUT.name)} WHERE ${fieldExpr("owner")} = ?`,
      "agent:1",
    );
    expect(plan.map((p) => p.detail).join()).toMatch(/USING (COVERING )?INDEX i:hut:owner/);

    for (const id of w.truth.ids(ENTITY)) {
      if (!id.startsWith("agent:")) continue;
      const huts = w.truth.ids(HUT).filter((h) => w.truth.get(HUT, h)?.owner === id);
      expect(store.findBy(HUT.name, "owner", id)).toEqual(huts);
      const acted = w.log
        .all()
        .filter((e) => e.actors.includes(id))
        .map((e) => e.id);
      expect(store.eventsOf(id)).toEqual(acted);
    }
    for (const e of w.log.all()) {
      expect(store.citing("event", e.id)).toEqual(w.log.effectsOf(e.id));
      const born = w.truth
        .ids(ENTITY)
        .filter((id) => w.truth.get(ENTITY, id)?.originEventId === e.id);
      expect(store.findBy(ENTITY.name, "originEventId", e.id)).toEqual(born);
    }
    expect(store.findBy("nada", "x", 1)).toEqual([]);
  });

  it("los planes del jugador se guardan en orden con el hash del texto", () => {
    const store = LifeStore.open(memory());
    expect(store.appendPlan(5, { verb: "walk", to: "place:3" }, "abc")).toBe(0);
    expect(store.appendPlan(9, { verb: "rest" })).toBe(1);
    expect(store.plans()).toEqual([
      { seq: 0, tick: 5, plan: { to: "place:3", verb: "walk" }, sourceTextHash: "abc" },
      { seq: 1, tick: 9, plan: { verb: "rest" } },
    ]);
  });

  it("meta guarda datos canónicos y protege la versión del formato", () => {
    const db = memory();
    const store = LifeStore.open(db);
    expect(store.hasSave).toBe(false);
    expect(() => store.load()).toThrow(PersistenceError);
    store.setMeta("seed", { value: 42, mode: "realista" });
    expect(store.getMeta("seed")).toEqual({ mode: "realista", value: 42 });
    expect(store.getMeta("format")).toBe(FORMAT_VERSION);
    expect(() => store.setMeta("format", 2)).toThrow(PersistenceError);

    db.run("UPDATE meta SET value = '999' WHERE key = 'format'");
    expect(() => LifeStore.open(db)).toThrow(/falta migración/);
  });
});
