// Factibilidad de un intercambio confirmado (economy §1/§3, dialogue §8): consulta saldos
// actuales y reservas explícitas antes de emitir hechos o asientos. No modifica el ledger.
import {
  compareStrings,
  isExternal,
  type LedgerAccount,
  type LedgerUnit,
  type Transfer,
} from "../../core/index.ts";

export interface SettlementReserve {
  readonly account: LedgerAccount;
  readonly unit: LedgerUnit;
  readonly minimum: number;
}

export interface SettlementShortage {
  readonly reason: "stock" | "reserve";
  readonly account: LedgerAccount;
  readonly unit: LedgerUnit;
  readonly before: number;
  readonly after: number;
  readonly minimum: number;
}

export type SettlementCheck =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly shortages: readonly SettlementShortage[] };

function safe(value: number): number {
  if (!Number.isSafeInteger(value))
    throw new RangeError("saldo o transferencia fuera del rango entero seguro");
  return value;
}

/**
 * Las patas entran juntas: se validan los saldos netos de toda la operación. Quien confirma
 * conserva la autoridad del ledger para validar cuentas externas y registrar el asiento.
 */
export function validateSettlement(
  ledger: { balance(account: LedgerAccount, unit: LedgerUnit): number },
  transfers: readonly Transfer[],
  reserves: readonly SettlementReserve[] = [],
): SettlementCheck {
  const rows = new Map<LedgerAccount, Map<LedgerUnit, { delta: number; minimum: number }>>();
  const row = (account: LedgerAccount, unit: LedgerUnit) => {
    let units = rows.get(account);
    if (!units) {
      units = new Map();
      rows.set(account, units);
    }
    let value = units.get(unit);
    if (!value) {
      value = { delta: 0, minimum: 0 };
      units.set(unit, value);
    }
    return value;
  };
  for (const transfer of transfers) {
    if (safe(transfer.amount) <= 0 || transfer.from === transfer.to)
      throw new RangeError("transferencia inválida para confirmar");
    const from = row(transfer.from, transfer.unit);
    const to = row(transfer.to, transfer.unit);
    from.delta = safe(from.delta - transfer.amount);
    to.delta = safe(to.delta + transfer.amount);
  }
  for (const reserve of reserves) {
    if (safe(reserve.minimum) < 0 || isExternal(reserve.account))
      throw new RangeError("reserva inválida para confirmar");
    const value = row(reserve.account, reserve.unit);
    value.minimum = Math.max(value.minimum, reserve.minimum);
  }
  const shortages: SettlementShortage[] = [];
  for (const [account, units] of [...rows].sort(([a], [b]) => compareStrings(a, b))) {
    for (const [unit, value] of [...units].sort(([a], [b]) => compareStrings(a, b))) {
      if (isExternal(account)) continue;
      const before = safe(ledger.balance(account, unit));
      const after = safe(before + value.delta);
      if (after < value.minimum)
        shortages.push({
          reason: after < 0 ? "stock" : "reserve",
          account,
          unit,
          before,
          after,
          minimum: value.minimum,
        });
    }
  }
  return shortages.length === 0 ? { allowed: true } : { allowed: false, shortages };
}
