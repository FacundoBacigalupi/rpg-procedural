// Snapshots de la verdad y sus diffs (tooling §1, §5; causality §10). Un snapshot es una copia
// congelada y canónica de cada componente (más, si hace falta, el valor de las presiones en ese
// momento); el diff entre dos dice qué entidades y componentes nacieron, desaparecieron o
// cambiaron, y qué presiones subieron o bajaron. Es puro y no escribe nada: sirve para el
// inspector en el tiempo (`at <tick>`) y para localizar qué proceso movió el estado.

import { canonicalJson, compareStrings, type Tick } from "../../core/index.ts";
import type { ReadonlyWorldTruth } from "./truth.ts";

/** El valor de una presión en el momento del snapshot, por clave `tipo@alcance`. */
export type PressureValues = Readonly<Record<string, number>>;

export interface TruthSnapshot {
  readonly tick: Tick;
  /** tabla → id → JSON canónico del componente. */
  readonly rows: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly pressures: PressureValues;
}

export function snapshotTruth(
  truth: ReadonlyWorldTruth,
  tick: Tick,
  pressures: PressureValues = {},
): TruthSnapshot {
  const rows: Record<string, Record<string, string>> = {};
  for (const name of truth.tables()) {
    const table = { name };
    const t: Record<string, string> = {};
    for (const id of truth.ids(table)) t[id] = canonicalJson(truth.get(table, id) ?? null);
    rows[name] = t;
  }
  return { tick, rows, pressures };
}

export interface ComponentChange {
  readonly table: string;
  readonly id: string;
  readonly before: string;
  readonly after: string;
}

export interface PressureChange {
  readonly key: string;
  /** `undefined` si no existía (o ya no existe) en ese extremo. */
  readonly before?: number;
  readonly after?: number;
}

export interface SnapshotDiff {
  readonly from: Tick;
  readonly to: Tick;
  readonly added: readonly { readonly table: string; readonly id: string }[];
  readonly removed: readonly { readonly table: string; readonly id: string }[];
  readonly changed: readonly ComponentChange[];
  readonly pressures: readonly PressureChange[];
}

const byKey = (a: { table: string; id: string }, b: { table: string; id: string }): number =>
  compareStrings(a.table, b.table) || compareStrings(a.id, b.id);

export function diffSnapshots(a: TruthSnapshot, b: TruthSnapshot): SnapshotDiff {
  const added: { table: string; id: string }[] = [];
  const removed: { table: string; id: string }[] = [];
  const changed: ComponentChange[] = [];
  for (const table of new Set([...Object.keys(a.rows), ...Object.keys(b.rows)])) {
    const ra = a.rows[table] ?? {};
    const rb = b.rows[table] ?? {};
    for (const id of Object.keys(rb)) {
      const after = rb[id] as string;
      const before = ra[id];
      if (before === undefined) added.push({ table, id });
      else if (before !== after) changed.push({ table, id, before, after });
    }
    for (const id of Object.keys(ra)) if (rb[id] === undefined) removed.push({ table, id });
  }
  const pressures: PressureChange[] = [];
  for (const key of new Set([...Object.keys(a.pressures), ...Object.keys(b.pressures)])) {
    const before = a.pressures[key];
    const after = b.pressures[key];
    if (before === after) continue;
    pressures.push({
      key,
      ...(before === undefined ? {} : { before }),
      ...(after === undefined ? {} : { after }),
    });
  }
  return {
    from: a.tick,
    to: b.tick,
    added: added.sort(byKey),
    removed: removed.sort(byKey),
    changed: changed.sort(byKey),
    pressures: pressures.sort((x, y) => compareStrings(x.key, y.key)),
  };
}

export function isEmptyDiff(d: SnapshotDiff): boolean {
  return !d.added.length && !d.removed.length && !d.changed.length && !d.pressures.length;
}

/** El diff en texto para la CLI; recorta cada lista a `limit` filas. */
export function formatSnapshotDiff(d: SnapshotDiff, limit = 40): string {
  const cut = <T>(xs: readonly T[], f: (x: T) => string): string[] => [
    ...xs.slice(0, limit).map(f),
    ...(xs.length > limit ? [`  … y ${xs.length - limit} más`] : []),
  ];
  const num = (n: number | undefined): string => (n === undefined ? "-" : n.toFixed(3));
  return [
    `diff t${d.from} → t${d.to}: +${d.added.length} -${d.removed.length} ~${d.changed.length} presiones ${d.pressures.length}`,
    ...cut(d.added, (x) => `  + ${x.table} ${x.id}`),
    ...cut(d.removed, (x) => `  - ${x.table} ${x.id}`),
    ...cut(d.changed, (x) => `  ~ ${x.table} ${x.id}`),
    ...cut(d.pressures, (x) => `  p ${x.key}: ${num(x.before)} → ${num(x.after)}`),
  ].join("\n");
}
