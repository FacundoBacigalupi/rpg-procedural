// El hash del estado (tooling §2): SHA-256 por tipo de componente y por cada parte que no es
// verdad (registro de eventos, diario del ledger, contadores de ids, scheduler), y uno total
// sobre esos. Sirve para el test de determinismo (se comparan hashes, no archivos), para el
// detector de divergencias del replay (qué partes difieren) y para probar que una herramienta
// no escribió nada.

import {
  canonicalHash,
  compareStrings,
  type EventLog,
  type IdCounterState,
  type Ledger,
} from "../../core/index.ts";
import type { ReadonlyWorldTruth } from "./truth.ts";

/** Lo que se hashea. Las partes que faltan no entran (un mundo sin ledger, un test chico). */
export interface StateParts {
  readonly truth: ReadonlyWorldTruth;
  readonly log?: EventLog;
  readonly ledger?: Ledger;
  readonly ids?: IdCounterState;
  /** El estado del scheduler, como dato (`Scheduler.state()`). */
  readonly scheduler?: unknown;
}

export interface StateHash {
  readonly total: string;
  /** `c:<tabla>` por tipo de componente, más `events`, `ledger`, `ids` y `scheduler`. */
  readonly parts: Readonly<Record<string, string>>;
}

export function hashState(s: StateParts): StateHash {
  const entries: [string, string][] = s.truth.tables().map((name) => {
    const table = { name };
    const rows = s.truth.ids(table).map((id) => [id, s.truth.get(table, id) ?? null]);
    return [`c:${name}`, canonicalHash(rows)];
  });
  if (s.log) entries.push(["events", canonicalHash(s.log.all())]);
  if (s.ledger) {
    entries.push([
      "ledger",
      canonicalHash({ config: s.ledger.config, journal: s.ledger.journal() }),
    ]);
  }
  if (s.ids) entries.push(["ids", canonicalHash(s.ids)]);
  if (s.scheduler !== undefined) entries.push(["scheduler", canonicalHash(s.scheduler)]);
  const parts = Object.fromEntries(entries);
  return { total: canonicalHash(parts), parts };
}

/** Las partes en que dos hashes difieren (las que están en uno solo también), ordenadas. */
export function diffStateHashes(a: StateHash, b: StateHash): string[] {
  const keys = new Set([...Object.keys(a.parts), ...Object.keys(b.parts)]);
  return [...keys].filter((k) => a.parts[k] !== b.parts[k]).sort(compareStrings);
}
