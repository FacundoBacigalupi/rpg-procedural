// La interfaz chica sobre SQLite (ARCHITECTURE §7.5): todo `persistence/` habla con esto, no con
// `node:sqlite`, para poder cambiar a `better-sqlite3` si el módulo de Node da problemas.

import { DatabaseSync, type StatementSync } from "node:sqlite";

export type SqlValue = null | number | bigint | string | Uint8Array;
export type SqlRow = Record<string, SqlValue>;

// Las filas se tipan donde se leen (`db.get<{ value: string }>(...)`): el driver no las valida.

export interface SqlDriver {
  /** Una o varias sentencias sin parámetros (esquema, pragmas). */
  exec(sql: string): void;
  run(sql: string, ...params: SqlValue[]): void;
  get<R = SqlRow>(sql: string, ...params: SqlValue[]): R | undefined;
  all<R = SqlRow>(sql: string, ...params: SqlValue[]): R[];
  /** Corre `fn` en una transacción: si tira, no queda nada escrito. No se anidan. */
  transaction<T>(fn: () => T): T;
  close(): void;
}

/** Abre (o crea) un archivo SQLite con `node:sqlite`; `":memory:"` para tests. */
export function openSqlite(path: string): SqlDriver {
  return new NodeSqliteDriver(new DatabaseSync(path));
}

class NodeSqliteDriver implements SqlDriver {
  readonly #db: DatabaseSync;
  readonly #statements = new Map<string, StatementSync>();
  #inTransaction = false;

  constructor(db: DatabaseSync) {
    this.#db = db;
    // WAL en archivos (tooling §1); en memoria SQLite lo ignora.
    db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;");
  }

  exec(sql: string): void {
    this.#db.exec(sql);
  }

  run(sql: string, ...params: SqlValue[]): void {
    this.#prepare(sql).run(...params);
  }

  get<R = SqlRow>(sql: string, ...params: SqlValue[]): R | undefined {
    return this.#prepare(sql).get(...params) as R | undefined;
  }

  all<R = SqlRow>(sql: string, ...params: SqlValue[]): R[] {
    return this.#prepare(sql).all(...params) as R[];
  }

  transaction<T>(fn: () => T): T {
    if (this.#inTransaction) throw new Error("transacción anidada");
    this.#inTransaction = true;
    this.#db.exec("BEGIN");
    try {
      const out = fn();
      this.#db.exec("COMMIT");
      return out;
    } catch (e) {
      this.#db.exec("ROLLBACK");
      throw e;
    } finally {
      this.#inTransaction = false;
    }
  }

  close(): void {
    this.#statements.clear();
    this.#db.close();
  }

  #prepare(sql: string): StatementSync {
    let st = this.#statements.get(sql);
    if (!st) {
      st = this.#db.prepare(sql);
      this.#statements.set(sql, st);
    }
    return st;
  }
}
