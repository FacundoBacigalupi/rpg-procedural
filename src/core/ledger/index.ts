// Ledger de conservación (causality Ley 2, economy "Fuentes y sumideros", cosmology §11).
//
// Doble entrada: cada movimiento sale de una cuenta y entra en otra, con el evento que lo causó.
// Nada se crea ni se destruye adentro del mundo. Lo que entra o sale pasa por cuentas externas
// (fuentes y sumideros) que se declaran al crear el ledger con las unidades que pueden tocar:
// si una fuente no está declarada, no existe. Por construcción, la suma de cada unidad sobre
// todas las cuentas es siempre 0, y las cuentas internas nunca quedan en negativo.
//
// Los montos son enteros seguros en la unidad mínima que elige cada sistema (gramos, granos de
// cobre, micro-unidades de esencia). Nada de floats: la igualdad es exacta.

import { compareStrings, type EventId } from "../ids/index.ts";
import type { Tick } from "../time/index.ts";
import { type HolderRef, holderKey } from "../types/index.ts";

declare const unitBrand: unique symbol;
declare const accountBrand: unique symbol;

/** Qué se cuenta: "good:rice", "coin:copper", "essence", "soul"... */
export type LedgerUnit = string & { readonly [unitBrand]: true };

/** Dónde está: un titular del mundo, o una fuente o sumidero externo ("ext:<nombre>"). */
export type LedgerAccount = string & { readonly [accountBrand]: true };

const EXTERNAL_PREFIX = "ext:";

export function ledgerUnit(name: string): LedgerUnit {
  if (name.length === 0) throw new TypeError("unidad vacía");
  return name as LedgerUnit;
}

export function holderAccount(holder: HolderRef): LedgerAccount {
  return holderKey(holder) as LedgerAccount;
}

export function externalAccount(name: string): LedgerAccount {
  if (name.length === 0) throw new TypeError("cuenta externa sin nombre");
  return `${EXTERNAL_PREFIX}${name}` as LedgerAccount;
}

export function isExternal(account: LedgerAccount): boolean {
  return account.startsWith(EXTERNAL_PREFIX);
}

export interface Transfer {
  readonly unit: LedgerUnit;
  readonly from: LedgerAccount;
  readonly to: LedgerAccount;
  readonly amount: number; // entero positivo
}

/** Un asiento: transferencias que pasan juntas o no pasan, por un evento. */
export interface Posting {
  readonly tick: Tick;
  readonly eventId: EventId;
  readonly transfers: readonly Transfer[];
}

export interface JournalEntry extends Transfer {
  readonly seq: number;
  readonly tick: Tick;
  readonly eventId: EventId;
}

export interface LedgerConfig {
  /** Fuentes y sumideros: nombre de la cuenta externa → unidades que puede mover. */
  readonly externals: Readonly<Record<string, readonly string[]>>;
}

export interface BalanceRow {
  readonly account: LedgerAccount;
  readonly unit: LedgerUnit;
  readonly amount: number;
}

export class LedgerError extends Error {
  override name = "LedgerError";
}

export class Ledger {
  readonly #config: LedgerConfig;
  readonly #externals: ReadonlyMap<LedgerAccount, ReadonlySet<string>>;
  readonly #balances = new Map<LedgerAccount, Map<LedgerUnit, number>>();
  readonly #journal: JournalEntry[] = [];

  constructor(config: LedgerConfig) {
    this.#config = config;
    const externals = new Map<LedgerAccount, ReadonlySet<string>>();
    for (const [name, units] of Object.entries(config.externals)) {
      externals.set(externalAccount(name), new Set(units));
    }
    this.#externals = externals;
  }

  /** Reconstruye un ledger aplicando un diario en orden (replay, verificación). */
  static fromJournal(config: LedgerConfig, journal: readonly JournalEntry[]): Ledger {
    const ledger = new Ledger(config);
    let i = 0;
    while (i < journal.length) {
      const first = journal[i] as JournalEntry;
      const transfers: Transfer[] = [];
      while (i < journal.length) {
        const e = journal[i] as JournalEntry;
        if (e.eventId !== first.eventId || e.tick !== first.tick) break;
        transfers.push({ unit: e.unit, from: e.from, to: e.to, amount: e.amount });
        i++;
      }
      ledger.post({ tick: first.tick, eventId: first.eventId, transfers });
    }
    return ledger;
  }

  balance(account: LedgerAccount, unit: LedgerUnit): number {
    return this.#balances.get(account)?.get(unit) ?? 0;
  }

  /** Lo que hay de una unidad dentro del mundo: la suma de las cuentas internas. */
  total(unit: LedgerUnit): number {
    let sum = 0;
    for (const [account, units] of this.#balances) {
      if (!isExternal(account)) sum += units.get(unit) ?? 0;
    }
    return sum;
  }

  /**
   * Agrupa lo interno por un criterio del que llama (región, plano, asentamiento) para auditar
   * la conservación por grupo. Las claves salen ordenadas.
   */
  totalsBy(unit: LedgerUnit, group: (account: LedgerAccount) => string): Map<string, number> {
    const sums = new Map<string, number>();
    for (const [account, units] of this.#balances) {
      if (isExternal(account)) continue;
      const amount = units.get(unit);
      if (amount === undefined) continue;
      const key = group(account);
      sums.set(key, (sums.get(key) ?? 0) + amount);
    }
    return new Map([...sums].sort(([a], [b]) => compareStrings(a, b)));
  }

  /**
   * Aplica un asiento entero o nada. Falla si una cuenta interna quedaría en negativo, si se usa
   * una fuente o sumidero no declarado para esa unidad, o si un monto no es entero positivo.
   */
  post(posting: Posting): void {
    if (posting.transfers.length === 0) throw new LedgerError("asiento sin transferencias");
    const delta = new Map<LedgerAccount, Map<LedgerUnit, number>>();
    const add = (account: LedgerAccount, unit: LedgerUnit, amount: number) => {
      let units = delta.get(account);
      if (!units) {
        units = new Map();
        delta.set(account, units);
      }
      units.set(unit, checked((units.get(unit) ?? 0) + amount));
    };

    for (const t of posting.transfers) {
      if (!Number.isSafeInteger(t.amount) || t.amount <= 0) {
        throw new LedgerError(`monto inválido ${t.amount} de ${t.unit} (${posting.eventId})`);
      }
      if (t.from === t.to) throw new LedgerError(`transferencia a sí misma: ${t.from}`);
      this.#checkExternal(t.from, t.unit, posting.eventId);
      this.#checkExternal(t.to, t.unit, posting.eventId);
      add(t.from, t.unit, -t.amount);
      add(t.to, t.unit, t.amount);
    }

    // Validar todo antes de tocar nada: el asiento entra entero o no entra.
    for (const [account, units] of delta) {
      for (const [unit, d] of units) {
        const after = checked(this.balance(account, unit) + d);
        if (after < 0 && !isExternal(account)) {
          throw new LedgerError(
            `${account} no tiene ${-d} de ${unit} (tiene ${this.balance(account, unit)}; ${posting.eventId})`,
          );
        }
      }
    }

    for (const [account, units] of delta) {
      let balances = this.#balances.get(account);
      if (!balances) {
        balances = new Map();
        this.#balances.set(account, balances);
      }
      for (const [unit, d] of units) {
        const after = checked((balances.get(unit) ?? 0) + d);
        if (after === 0) balances.delete(unit);
        else balances.set(unit, after);
      }
      if (balances.size === 0) this.#balances.delete(account);
    }

    for (const t of posting.transfers) {
      this.#journal.push({
        seq: this.#journal.length,
        tick: posting.tick,
        eventId: posting.eventId,
        unit: t.unit,
        from: t.from,
        to: t.to,
        amount: t.amount,
      });
    }
  }

  journal(): readonly JournalEntry[] {
    return this.#journal;
  }

  /** Saldos distintos de cero, ordenados por cuenta y unidad: para guardar y hashear. */
  balances(): BalanceRow[] {
    const rows: BalanceRow[] = [];
    for (const account of [...this.#balances.keys()].sort(compareStrings)) {
      const units = this.#balances.get(account) as Map<LedgerUnit, number>;
      for (const unit of [...units.keys()].sort(compareStrings)) {
        rows.push({ account, unit, amount: units.get(unit) as number });
      }
    }
    return rows;
  }

  /**
   * Invariantes de conservación, para tests y el modo debug: cada unidad suma 0 sobre todas las
   * cuentas, ninguna cuenta interna está en negativo, y el diario reproduce los saldos.
   * Devuelve las violaciones encontradas (vacío si todo cuadra).
   */
  audit(): string[] {
    const problems: string[] = [];
    const sums = new Map<LedgerUnit, number>();
    for (const row of this.balances()) {
      sums.set(row.unit, (sums.get(row.unit) ?? 0) + row.amount);
      if (!isExternal(row.account) && row.amount < 0) {
        problems.push(`${row.account} en negativo: ${row.amount} de ${row.unit}`);
      }
    }
    for (const [unit, sum] of sums) {
      if (sum !== 0) problems.push(`${unit} no suma 0: ${sum}`);
    }
    const replayed = Ledger.fromJournal(this.#config, this.#journal).balances();
    if (JSON.stringify(replayed) !== JSON.stringify(this.balances())) {
      problems.push("el diario no reproduce los saldos");
    }
    return problems;
  }

  #checkExternal(account: LedgerAccount, unit: LedgerUnit, eventId: EventId): void {
    if (!isExternal(account)) return;
    const units = this.#externals.get(account);
    if (!units) throw new LedgerError(`fuente o sumidero no declarado: ${account} (${eventId})`);
    if (!units.has(unit)) {
      throw new LedgerError(`${account} no puede mover ${unit} (${eventId})`);
    }
  }
}

function checked(n: number): number {
  if (!Number.isSafeInteger(n)) throw new LedgerError(`desborde de entero seguro: ${n}`);
  return n;
}
