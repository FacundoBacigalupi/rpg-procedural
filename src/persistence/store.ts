// El guardado de una vida (tooling §1): la verdad entera, el registro de eventos, el diario del
// ledger, los contadores de ids y el estado del scheduler. `save` escribe todo lo que cambió
// desde el último guardado en una transacción (el turno del jugador): eventos y asientos nuevos,
// y los componentes cuyo hash cambió. `load` rehace el mundo y lo valida de nuevo (el registro
// revisa causas; el ledger, la conservación).
//
// Los snapshots son el estado completo en un tick, comprimido con zstd: la verdad, los
// contadores, el scheduler y hasta dónde llegaban el registro y el diario, que se leen de sus
// tablas al rehacerlo. Sirven para el `at <tick>` del inspector y para el límite de replay.

import { createHash } from "node:crypto";
import { zstdCompressSync, zstdDecompressSync } from "node:zlib";
import {
  type CauseRef,
  canonicalJson,
  compareIds,
  type EntityRef,
  type Event,
  type EventId,
  EventLog,
  type IdCounterState,
  type JournalEntry,
  Ledger,
  type LedgerAccount,
  type LedgerConfig,
  type LedgerUnit,
  parseId,
  type Tick,
} from "../core/index.ts";
import {
  ENTITY,
  hashState,
  type SchedulerState,
  type StateHash,
  WorldTruth,
} from "../sim/index.ts";
import type { SqlDriver } from "./driver.ts";
import {
  componentTable,
  componentTables,
  createSchema,
  ensureComponentTable,
  ensureFieldIndex,
  FORMAT_VERSION,
  fieldExpr,
} from "./schema.ts";

export class PersistenceError extends Error {
  override name = "PersistenceError";
}

/** Todo lo que hace falta para seguir una vida desde donde quedó. */
export interface LifeState {
  readonly truth: WorldTruth;
  readonly log: EventLog;
  readonly ledger: Ledger;
  readonly ids: IdCounterState;
  readonly scheduler: SchedulerState;
}

export interface LifeStoreOptions {
  /** Índices del inspector: tipo de componente → campos del JSON (`{ hut: ["owner"] }`). */
  readonly indexes?: Readonly<Record<string, readonly string[]>>;
}

/** Los índices que siempre están: de qué evento salió cada entidad y cuál la terminó. */
const BASE_INDEXES: Readonly<Record<string, readonly string[]>> = {
  [ENTITY.name]: ["originEventId", "endEventId", "createdAt"],
};

interface SnapshotBody {
  readonly tick: Tick;
  readonly rows: readonly { table: string; id: EntityRef; value: unknown }[];
  readonly ids: IdCounterState;
  readonly scheduler: SchedulerState;
  readonly ledgerConfig: LedgerConfig;
  readonly lastEvent: number;
  readonly journalLength: number;
}

export function sha256(text: string | Uint8Array): string {
  return createHash("sha256").update(text).digest("hex");
}

export class LifeStore {
  readonly #db: SqlDriver;
  /** Hash de cada componente guardado, por tabla: lo que se compara para escribir solo cambios. */
  #hashes: Map<string, Map<EntityRef, string>> | undefined;

  private constructor(db: SqlDriver) {
    this.#db = db;
  }

  /** Abre el guardado de una vida; si está vacío, crea el esquema. */
  static open(db: SqlDriver, options: LifeStoreOptions = {}): LifeStore {
    db.transaction(() => {
      createSchema(db);
      const format = db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'format'");
      if (!format) {
        db.run("INSERT INTO meta (key, value) VALUES ('format', ?)", String(FORMAT_VERSION));
      } else if (Number(format.value) !== FORMAT_VERSION) {
        throw new PersistenceError(
          `formato de guardado ${format.value}, este motor lee el ${FORMAT_VERSION} (falta migración)`,
        );
      }
      for (const indexes of [BASE_INDEXES, options.indexes ?? {}]) {
        for (const [name, fields] of Object.entries(indexes)) {
          for (const field of fields) ensureFieldIndex(db, name, field);
        }
      }
    });
    return new LifeStore(db);
  }

  get hasSave(): boolean {
    return this.#db.get("SELECT 1 AS x FROM meta WHERE key = 'scheduler'") !== undefined;
  }

  setMeta(key: string, value: unknown): void {
    if (key === "format") throw new PersistenceError("la versión del formato la pone el guardado");
    this.#db.run(
      "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      key,
      canonicalJson(value),
    );
  }

  getMeta(key: string): unknown {
    const row = this.#db.get<{ value: string }>("SELECT value FROM meta WHERE key = ?", key);
    return row ? JSON.parse(row.value) : undefined;
  }

  /** Escribe lo que cambió desde el último guardado, todo o nada. */
  save(state: LifeState): void {
    this.#write(() => this.#save(state));
  }

  load(): LifeState {
    const scheduler = this.getMeta("scheduler") as SchedulerState | undefined;
    if (!scheduler) throw new PersistenceError("el archivo no tiene una vida guardada");
    const truth = new WorldTruth();
    for (const name of componentTables(this.#db)) {
      for (const r of this.#db.all<{ id: EntityRef; data: string }>(
        `SELECT id, data FROM ${componentTable(name)} ORDER BY id`,
      )) {
        truth.setRaw(name, r.id, JSON.parse(r.data));
      }
    }
    return {
      truth,
      log: this.#events(Number.MAX_SAFE_INTEGER),
      ledger: this.#ledger(this.getMeta("ledger") as LedgerConfig, Number.MAX_SAFE_INTEGER),
      ids: this.getMeta("ids") as IdCounterState,
      scheduler,
    };
  }

  /**
   * Guarda y además deja el estado completo de este tick comprimido. Un segundo snapshot del
   * mismo tick y tipo reemplaza al primero.
   */
  saveSnapshot(state: LifeState, kind = "full"): void {
    this.#write(() => {
      this.#save(state);
      const body: SnapshotBody = {
        tick: state.scheduler.now,
        rows: state.truth.rows(),
        ids: state.ids,
        scheduler: state.scheduler,
        ledgerConfig: state.ledger.config,
        lastEvent: state.log.lastNumber,
        journalLength: state.ledger.journal().length,
      };
      const json = canonicalJson(body);
      this.#db.run(
        "INSERT OR REPLACE INTO snapshots (tick, kind, blob, hash, state_hash) VALUES (?, ?, ?, ?, ?)",
        body.tick,
        kind,
        zstdCompressSync(json),
        sha256(json),
        canonicalJson(hashState(state)),
      );
    });
  }

  snapshots(): { tick: Tick; kind: string }[] {
    return this.#db
      .all<{ tick: Tick; kind: string }>("SELECT tick, kind FROM snapshots ORDER BY tick, kind")
      .map((r) => ({ tick: r.tick, kind: r.kind }));
  }

  /** El hash del estado en cada snapshot del tipo pedido: lo que el replay compara. */
  checkpoints(kind = "full"): { tick: Tick; hash: StateHash }[] {
    return this.#db
      .all<{ tick: Tick; state_hash: string }>(
        "SELECT tick, state_hash FROM snapshots WHERE kind = ? ORDER BY tick",
        kind,
      )
      .map((r) => ({ tick: r.tick, hash: JSON.parse(r.state_hash) as StateHash }));
  }

  /** Rehace el mundo como estaba en un snapshot. */
  loadSnapshot(tick: Tick, kind = "full"): LifeState {
    const row = this.#db.get<{ blob: Uint8Array; hash: string }>(
      "SELECT blob, hash FROM snapshots WHERE tick = ? AND kind = ?",
      tick,
      kind,
    );
    if (!row) throw new PersistenceError(`no hay snapshot ${kind} en ${tick}`);
    const json = zstdDecompressSync(row.blob).toString("utf8");
    if (sha256(json) !== row.hash) throw new PersistenceError(`snapshot ${kind}@${tick} dañado`);
    const body = JSON.parse(json) as SnapshotBody;
    const truth = new WorldTruth();
    for (const r of body.rows) truth.setRaw(r.table, r.id, r.value);
    return {
      truth,
      log: this.#events(body.lastEvent),
      ledger: this.#ledger(body.ledgerConfig, body.journalLength),
      ids: body.ids,
      scheduler: body.scheduler,
    };
  }

  /** Lo que entra al replay (tooling §3): el plan validado, nunca el texto. */
  appendPlan(tick: Tick, plan: unknown, sourceTextHash?: string): number {
    const seq = Number(
      this.#db.get<{ seq: number }>("SELECT coalesce(max(seq), -1) + 1 AS seq FROM player_plans")
        ?.seq,
    );
    this.#db.run(
      "INSERT INTO player_plans (seq, tick, plan, source_text_hash) VALUES (?, ?, ?, ?)",
      seq,
      tick,
      canonicalJson(plan),
      sourceTextHash ?? null,
    );
    return seq;
  }

  plans(): { seq: number; tick: Tick; plan: unknown; sourceTextHash?: string }[] {
    return this.#db
      .all<{ seq: number; tick: Tick; plan: string; source_text_hash: string | null }>(
        "SELECT seq, tick, plan, source_text_hash FROM player_plans ORDER BY seq",
      )
      .map((r) => ({
        seq: r.seq,
        tick: r.tick,
        plan: JSON.parse(r.plan),
        ...(r.source_text_hash === null ? {} : { sourceTextHash: r.source_text_hash }),
      }));
  }

  // --- Consultas del inspector (solo lectura, sobre lo guardado) ---

  /** Ids con un componente cuyo campo vale `value`, en orden canónico; usa el índice si se declaró. */
  findBy(name: string, field: string, value: string | number): EntityRef[] {
    if (!componentTables(this.#db).includes(name)) return [];
    return this.#db
      .all<{ id: EntityRef }>(
        `SELECT id FROM ${componentTable(name)} WHERE ${fieldExpr(field)} = ?`,
        value,
      )
      .map((r) => r.id)
      .sort(compareIds);
  }

  /** Los eventos en que actuó una entidad, en orden. */
  eventsOf(actor: EntityRef): EventId[] {
    return this.#db
      .all<{ id: EventId }>(
        "SELECT e.id FROM event_actors a JOIN events e ON e.n = a.event_n WHERE a.actor = ? ORDER BY a.event_n",
        actor,
      )
      .map((r) => r.id);
  }

  /** Los eventos que citan una causa (un evento, una presión, una creencia, `entidad#clave`). */
  citing(kind: CauseRef["kind"], ref: string): EventId[] {
    return this.#db
      .all<{ id: EventId }>(
        "SELECT DISTINCT e.n, e.id FROM causes c JOIN events e ON e.n = c.event_n WHERE c.cause_kind = ? AND c.cause_ref = ? ORDER BY e.n",
        kind,
        ref,
      )
      .map((r) => r.id);
  }

  /** El hash guardado de un componente, o undefined si no está. */
  componentHash(name: string, id: EntityRef): string | undefined {
    if (!componentTables(this.#db).includes(name)) return undefined;
    return this.#db.get<{ hash: string }>(
      `SELECT hash FROM ${componentTable(name)} WHERE id = ?`,
      id,
    )?.hash;
  }

  // --- Escritura ---

  /** Una transacción; si falla, el caché de hashes ya no refleja el archivo y se descarta. */
  #write(fn: () => void): void {
    try {
      this.#db.transaction(fn);
    } catch (e) {
      this.#hashes = undefined;
      throw e;
    }
  }

  #save(state: LifeState): void {
    this.#saveEvents(state.log);
    this.#saveJournal(state.ledger);
    this.#saveComponents(state.truth);
    this.setMeta("ledger", state.ledger.config);
    this.setMeta("ids", state.ids);
    this.setMeta("scheduler", state.scheduler);
  }

  #saveEvents(log: EventLog): void {
    const saved = Number(
      this.#db.get<{ n: number }>("SELECT coalesce(max(n), 0) AS n FROM events")?.n,
    );
    if (log.lastNumber < saved) {
      throw new PersistenceError(
        `el registro llega a event:${log.lastNumber} y el guardado a event:${saved}`,
      );
    }
    const events = log.all();
    let i = events.length;
    while (i > 0 && idNumber((events[i - 1] as Event).id) > saved) i--;
    for (const e of events.slice(i)) {
      const n = idNumber(e.id);
      const data = canonicalJson(e);
      this.#db.run(
        "INSERT INTO events (n, id, tick, kind, resolution, data, hash) VALUES (?, ?, ?, ?, ?, ?, ?)",
        n,
        e.id,
        e.tick,
        e.kind,
        e.resolution,
        data,
        sha256(data),
      );
      for (const actor of new Set(e.actors)) {
        this.#db.run("INSERT INTO event_actors (event_n, actor) VALUES (?, ?)", n, actor);
      }
      e.causes.forEach((c, ord) => {
        this.#db.run(
          "INSERT INTO causes (event_n, ord, cause_kind, cause_ref, weight) VALUES (?, ?, ?, ?, ?)",
          n,
          ord,
          c.kind,
          causeRef(c),
          c.kind === "seed" ? null : (c.weight ?? null),
        );
      });
    }
  }

  #saveJournal(ledger: Ledger): void {
    const saved = Number(this.#db.get<{ c: number }>("SELECT count(*) AS c FROM ledger")?.c);
    const journal = ledger.journal();
    if (journal.length < saved) {
      throw new PersistenceError(
        `el diario tiene ${journal.length} asientos y el guardado ${saved}`,
      );
    }
    for (const j of journal.slice(saved)) {
      this.#db.run(
        "INSERT INTO ledger (seq, tick, event_id, unit, from_account, to_account, amount) VALUES (?, ?, ?, ?, ?, ?, ?)",
        j.seq,
        j.tick,
        j.eventId,
        j.unit,
        j.from,
        j.to,
        j.amount,
      );
    }
  }

  #saveComponents(truth: WorldTruth): void {
    const hashes = this.#savedHashes();
    const seen = new Map<string, Set<EntityRef>>();
    for (const { table, id, value } of truth.rows()) {
      let live = seen.get(table);
      if (!live) {
        live = new Set();
        seen.set(table, live);
      }
      live.add(id);
      const data = canonicalJson(value);
      const hash = sha256(data);
      let saved = hashes.get(table);
      if (!saved) {
        ensureComponentTable(this.#db, table);
        saved = new Map();
        hashes.set(table, saved);
      }
      if (saved.get(id) === hash) continue;
      this.#db.run(
        `INSERT INTO ${componentTable(table)} (id, data, hash) VALUES (?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET data = excluded.data, hash = excluded.hash`,
        id,
        data,
        hash,
      );
      saved.set(id, hash);
    }
    for (const [table, saved] of hashes) {
      const live = seen.get(table);
      for (const id of [...saved.keys()]) {
        if (live?.has(id)) continue;
        this.#db.run(`DELETE FROM ${componentTable(table)} WHERE id = ?`, id);
        saved.delete(id);
      }
    }
  }

  #savedHashes(): Map<string, Map<EntityRef, string>> {
    if (!this.#hashes) {
      const all = new Map<string, Map<EntityRef, string>>();
      for (const name of componentTables(this.#db)) {
        const rows = new Map<EntityRef, string>();
        for (const r of this.#db.all<{ id: EntityRef; hash: string }>(
          `SELECT id, hash FROM ${componentTable(name)}`,
        )) {
          rows.set(r.id, r.hash);
        }
        all.set(name, rows);
      }
      this.#hashes = all;
    }
    return this.#hashes;
  }

  // --- Lectura ---

  #events(upTo: number): EventLog {
    return EventLog.from(
      this.#db
        .all<{ data: string }>("SELECT data FROM events WHERE n <= ? ORDER BY n", upTo)
        .map((r) => JSON.parse(r.data) as Event),
    );
  }

  #ledger(config: LedgerConfig, length: number): Ledger {
    return Ledger.fromJournal(
      config,
      this.#db
        .all<LedgerRow>("SELECT * FROM ledger WHERE seq < ? ORDER BY seq", length)
        .map(journalEntry),
    );
  }
}

interface LedgerRow {
  seq: number;
  tick: Tick;
  event_id: EventId;
  unit: LedgerUnit;
  from_account: LedgerAccount;
  to_account: LedgerAccount;
  amount: number;
}

function journalEntry(r: LedgerRow): JournalEntry {
  return {
    seq: r.seq,
    tick: r.tick,
    eventId: r.event_id,
    unit: r.unit,
    from: r.from_account,
    to: r.to_account,
    amount: r.amount,
  };
}

/** La referencia indexable de una causa: lo que busca `effects` del inspector. */
function causeRef(c: CauseRef): string | null {
  switch (c.kind) {
    case "event":
      return c.event;
    case "pressure":
      return c.pressure;
    case "belief":
      return c.belief;
    case "state":
      return `${c.entity}#${c.key}`;
    case "seed":
      return null;
  }
}

function idNumber(id: EventId): number {
  return parseId(id)?.n as number;
}
