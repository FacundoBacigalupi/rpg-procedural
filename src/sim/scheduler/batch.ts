// Overlays privados de un lote serial: no escriben la verdad ni el ledger del mundo.
import {
  compareIds,
  type EntityRef,
  type EventId,
  isExternal,
  type Ledger,
  type LedgerAccount,
  type LedgerUnit,
  type Transfer,
} from "../../core/index.ts";
import type { ReadonlyWorldTruth, Table } from "../world/index.ts";
import { parseDraftRef, type StateChange } from "./process.ts";

const REMOVED = Symbol("removed");

function compareBatchRefs(a: EntityRef, b: EntityRef): number {
  const da = parseDraftRef(a);
  const db = parseDraftRef(b);
  if (!da && !db) return compareIds(a, b);
  if (!da) return -1;
  if (!db) return 1;
  return da.kind < db.kind ? -1 : da.kind > db.kind ? 1 : da.n - db.n;
}

export class BatchTruth implements ReadonlyWorldTruth {
  readonly #base: ReadonlyWorldTruth;
  readonly #rows = new Map<string, Map<EntityRef, unknown>>();
  constructor(base: ReadonlyWorldTruth) {
    this.#base = base;
  }
  get<T>(t: Table<T>, id: EntityRef): Readonly<T> | undefined {
    const rows = this.#rows.get(t.name);
    if (!rows?.has(id)) return this.#base.get(t, id);
    const value = rows.get(id);
    return value === REMOVED ? undefined : (value as T);
  }
  has(t: Table<unknown>, id: EntityRef): boolean {
    return this.get(t, id) !== undefined;
  }
  ids(t: Table<unknown>): EntityRef[] {
    // Sin filas propias en la tabla el lote ve lo mismo que la base, ya en orden.
    if (!this.#rows.get(t.name)?.size) return this.#base.ids(t);
    const ids = new Set(this.#base.ids(t));
    for (const [id, value] of this.#rows.get(t.name) ?? []) {
      if (value === REMOVED) ids.delete(id);
      else ids.add(id);
    }
    return [...ids].sort(compareBatchRefs);
  }
  tables(): string[] {
    return [...new Set([...this.#base.tables(), ...this.#rows.keys()])]
      .sort()
      .filter((name) => this.ids({ name }).length > 0);
  }
  apply(change: StateChange): void {
    const table = { name: change.table };
    let value: unknown = change.op === "set" ? change.value : REMOVED;
    if (change.op === "delete" && !this.has(table, change.id))
      throw new Error(`borrado inexistente: ${change.table}/${change.id}`);
    if (change.op === "add") {
      const old = this.get(table, change.id) as Record<string, unknown> | undefined;
      const before = old?.[change.field];
      if (typeof before !== "number")
        throw new Error(`suma sin número: ${change.table}/${change.id}`);
      value = { ...old, [change.field]: before + change.amount };
    }
    let rows = this.#rows.get(change.table);
    if (!rows) {
      rows = new Map();
      this.#rows.set(change.table, rows);
    }
    rows.set(change.id, value);
  }
  changes(): StateChange[] {
    return [...this.#rows]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .flatMap(([table, rows]) =>
        [...rows]
          .sort((a, b) => compareBatchRefs(a[0], b[0]))
          .flatMap(([id, value]): StateChange[] =>
            value === REMOVED
              ? this.#base.has({ name: table }, id)
                ? [{ op: "delete", table, id }]
                : []
              : [{ op: "set", table, id, value }],
          ),
      );
  }
}

export class BatchLedger {
  readonly #base: Ledger;
  readonly #balances = new Map<LedgerAccount, Map<LedgerUnit, number>>();
  readonly #deltas = new Map<LedgerUnit, number>();
  constructor(base: Ledger) {
    this.#base = base;
  }
  balance(account: LedgerAccount, unit: LedgerUnit): number {
    return this.#balances.get(account)?.get(unit) ?? this.#base.balance(account, unit);
  }
  holdings(account: LedgerAccount): { unit: LedgerUnit; amount: number }[] {
    const units = new Map(this.#base.holdings(account).map((v) => [v.unit, v.amount]));
    for (const [unit, amount] of this.#balances.get(account) ?? []) units.set(unit, amount);
    return [...units]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .filter((v) => v[1] !== 0)
      .map(([unit, amount]) => ({ unit, amount }));
  }
  total(unit: LedgerUnit): number {
    return this.#base.total(unit) + (this.#deltas.get(unit) ?? 0);
  }
  post(transfers: readonly Transfer[]): void {
    const rows = this.#base.preview(
      { tick: 0, eventId: "event:1" as EventId, transfers },
      (account, unit) => this.balance(account, unit),
    );
    for (const { account, unit, amount: after } of rows) {
      const before = this.balance(account, unit);
      let row = this.#balances.get(account);
      if (!row) {
        row = new Map();
        this.#balances.set(account, row);
      }
      row.set(unit, after);
      if (!isExternal(account))
        this.#deltas.set(unit, (this.#deltas.get(unit) ?? 0) + after - before);
    }
  }
}

/** IDs de eventos privados distintos de draftEvent para no confundir referencias del lote anterior. */
export function batchEvents<T>(value: T, offset: number, finish = false): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      const pattern = finish ? /^event:batch:(\d+)$/ : /^event:~(\d+)$/;
      const found = pattern.exec(v);
      return found
        ? finish
          ? `event:~${found[1]}`
          : `event:batch:${Number(found[1]) + offset}`
        : v;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === "object")
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [walk(k), walk(x)]));
    return v;
  };
  return walk(value) as T;
}
