// El esquema del guardado (tooling §1, ARCHITECTURE §7.5). Un archivo por vida. Cada tipo de
// componente tiene su propia tabla `"c:<nombre>"` con el id, el JSON canónico y su hash; lo que
// consulta el inspector va en índices sobre expresiones (`json_extract`), así agregar un índice no
// cambia el esquema. El registro de eventos y el diario del ledger son de solo agregado.
//
// Diferencias con el borrador de tooling §1: la ficha `entities` es el componente `entity` (una
// tabla de componente más, con índices por origen y fin); el ledger guarda transferencias (de,
// a, cantidad) y no filas de débito y crédito, porque así lo rehace `Ledger.fromJournal`.
// Creencias, memorias, diffs y narración llegan con sus tareas.

import type { SqlDriver } from "./driver.ts";

/** Versión del formato de guardado (tooling §4): cada cambio trae su migración. */
export const FORMAT_VERSION = 1;

const DDL = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS events (
  n          INTEGER PRIMARY KEY,
  id         TEXT NOT NULL UNIQUE,
  tick       INTEGER NOT NULL,
  kind       TEXT NOT NULL,
  resolution TEXT NOT NULL,
  data       TEXT NOT NULL,
  hash       TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS events_tick ON events (tick);
CREATE INDEX IF NOT EXISTS events_kind ON events (kind, tick);

CREATE TABLE IF NOT EXISTS event_actors (
  event_n INTEGER NOT NULL REFERENCES events (n),
  actor   TEXT NOT NULL,
  PRIMARY KEY (event_n, actor)
) STRICT, WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS event_actors_actor ON event_actors (actor, event_n);

CREATE TABLE IF NOT EXISTS causes (
  event_n    INTEGER NOT NULL REFERENCES events (n),
  ord        INTEGER NOT NULL,
  cause_kind TEXT NOT NULL,
  cause_ref  TEXT,
  weight     REAL,
  PRIMARY KEY (event_n, ord)
) STRICT, WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS causes_ref ON causes (cause_kind, cause_ref, event_n);

CREATE TABLE IF NOT EXISTS ledger (
  seq          INTEGER PRIMARY KEY,
  tick         INTEGER NOT NULL,
  event_id     TEXT NOT NULL,
  unit         TEXT NOT NULL,
  from_account TEXT NOT NULL,
  to_account   TEXT NOT NULL,
  amount       INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS ledger_from ON ledger (from_account, unit, seq);
CREATE INDEX IF NOT EXISTS ledger_to ON ledger (to_account, unit, seq);
CREATE INDEX IF NOT EXISTS ledger_event ON ledger (event_id);

CREATE TABLE IF NOT EXISTS player_plans (
  seq              INTEGER PRIMARY KEY,
  tick             INTEGER NOT NULL,
  plan             TEXT NOT NULL,
  source_text_hash TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS snapshots (
  tick INTEGER NOT NULL,
  kind TEXT NOT NULL,
  blob BLOB NOT NULL,
  hash TEXT NOT NULL,
  -- El hash del estado (tooling §2) en ese tick: los checkpoints del replay.
  state_hash TEXT NOT NULL,
  PRIMARY KEY (tick, kind)
) STRICT;
`;

export function componentTable(name: string): string {
  return quote(`c:${name}`);
}

/** Crea la tabla de un tipo de componente si no está. */
export function ensureComponentTable(db: SqlDriver, name: string): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS ${componentTable(name)} (
      id   TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      hash TEXT NOT NULL
    ) STRICT, WITHOUT ROWID;`,
  );
}

/** Un índice del inspector sobre un campo del JSON de un componente (`$.owner`, `$.pos.cell`). */
export function ensureFieldIndex(db: SqlDriver, name: string, field: string): void {
  ensureComponentTable(db, name);
  db.exec(
    `CREATE INDEX IF NOT EXISTS ${quote(`i:${name}:${field}`)}
       ON ${componentTable(name)} (${fieldExpr(field)});`,
  );
}

export function fieldExpr(field: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(field)) {
    throw new TypeError(`campo de índice inválido: ${field}`);
  }
  return `json_extract(data, '$.${field}')`;
}

/** Los tipos de componente que tienen tabla en el archivo. */
export function componentTables(db: SqlDriver): string[] {
  return db
    .all<{ name: string }>(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name LIKE 'c:%' ORDER BY name",
    )
    .map((r) => r.name.slice(2));
}

export function createSchema(db: SqlDriver): void {
  db.exec(DDL);
}

function quote(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}
