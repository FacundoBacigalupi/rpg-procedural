// La verdad del mundo (ARCHITECTURE §4.4, §5): un ECS liviano. Cada sistema guarda sus componentes
// en su propia tabla, por id de entidad (el `Body` de un agente, su `Mind`, el stock de un granero).
// Los procesos leen por `ReadonlyWorldTruth` y escriben solo con diffs que aplica el scheduler.
//
// Por ahora es solo el almacén; las celdas, los lugares, el grafo de espacios y la materialización
// por ranuras (simulation §6, perception §3) llegan con sus tareas.

import { compareIds, compareStrings, type EntityRef } from "../../core/index.ts";

declare const valueType: unique symbol;

/** Una tabla de componentes con el tipo de sus valores. El nombre es lo que se guarda. */
export interface Table<T> {
  readonly name: string;
  readonly [valueType]?: T;
}

/** Declara una tabla: `const BODY = table<Body>("body")`. */
export function table<T>(name: string): Table<T> {
  if (!/^[a-z][a-z0-9_.]*$/.test(name)) throw new TypeError(`nombre de tabla inválido: ${name}`);
  return { name };
}

export interface ReadonlyWorldTruth {
  get<T>(table: Table<T>, id: EntityRef): Readonly<T> | undefined;
  has(table: Table<unknown>, id: EntityRef): boolean;
  /** Ids con componente en la tabla, en orden canónico. */
  ids(table: Table<unknown>): EntityRef[];
  /** Nombres de las tablas con algún componente, ordenados. */
  tables(): string[];
}

/**
 * Los valores se tratan como inmutables: escribir es reemplazar. Nadie fuera del scheduler (y de
 * worldgen, al sembrar) llama a `set` o `delete`.
 */
export class WorldTruth implements ReadonlyWorldTruth {
  readonly #tables = new Map<string, Map<EntityRef, unknown>>();

  get<T>(table: Table<T>, id: EntityRef): Readonly<T> | undefined {
    return this.#tables.get(table.name)?.get(id) as T | undefined;
  }

  has(table: Table<unknown>, id: EntityRef): boolean {
    return this.#tables.get(table.name)?.has(id) ?? false;
  }

  ids(table: Table<unknown>): EntityRef[] {
    const rows = this.#tables.get(table.name);
    return rows ? [...rows.keys()].sort(compareIds) : [];
  }

  tables(): string[] {
    return [...this.#tables.keys()].sort(compareStrings);
  }

  /** Lectura por nombre de tabla, para el scheduler y las herramientas. */
  getRaw(tableName: string, id: EntityRef): unknown {
    return this.#tables.get(tableName)?.get(id);
  }

  hasRaw(tableName: string, id: EntityRef): boolean {
    return this.#tables.get(tableName)?.has(id) ?? false;
  }

  set<T>(table: Table<T>, id: EntityRef, value: T): void {
    this.setRaw(table.name, id, value);
  }

  setRaw(tableName: string, id: EntityRef, value: unknown): void {
    let rows = this.#tables.get(tableName);
    if (!rows) {
      rows = new Map();
      this.#tables.set(tableName, rows);
    }
    rows.set(id, value);
  }

  deleteRaw(tableName: string, id: EntityRef): void {
    const rows = this.#tables.get(tableName);
    if (!rows) return;
    rows.delete(id);
    if (rows.size === 0) this.#tables.delete(tableName);
  }

  /** Todo en orden canónico (tabla, id): para hashear, guardar y comparar en tests. */
  rows(): { table: string; id: EntityRef; value: unknown }[] {
    const out: { table: string; id: EntityRef; value: unknown }[] = [];
    for (const name of this.tables()) {
      const rows = this.#tables.get(name) as Map<EntityRef, unknown>;
      for (const id of [...rows.keys()].sort(compareIds))
        out.push({ table: name, id, value: rows.get(id) });
    }
    return out;
  }
}
