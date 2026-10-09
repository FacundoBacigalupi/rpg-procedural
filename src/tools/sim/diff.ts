// Comparar corridas (tooling §6, `sim:diff`): aplana las métricas numéricas de un reporte (o la
// media de un lote) y muestra cómo cambian entre A y B. Puro: no corre nada ni toca el disco.

import type { SimReport } from "./sim.ts";

export type FlatMetrics = Readonly<Record<string, number>>;

/** Métricas numéricas del reporte con claves punteadas (`metrics.eventsByKind.body.died`). */
export function flattenMetrics(report: SimReport): FlatMetrics {
  const out: Record<string, number> = {};
  const walk = (prefix: string, value: unknown): void => {
    if (typeof value === "number") {
      if (Number.isFinite(value)) out[prefix] = value;
    } else if (typeof value === "boolean") {
      out[prefix] = value ? 1 : 0;
    } else if (value !== null && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) walk(`${prefix}.${k}`, v);
    }
  };
  walk("metrics", report.metrics);
  out["checks"] = report.checks;
  out["stoppedEarly"] = report.stoppedEarly ? 1 : 0;
  return out;
}

export interface DiffRow {
  readonly key: string;
  readonly a: number;
  readonly b: number;
  readonly delta: number;
  /** Cambio relativo a A (`delta / |a|`); `undefined` si A es 0 y B no. */
  readonly rel: number | undefined;
}

/** Filas que cambian entre A y B (una clave ausente cuenta 0), ordenadas por clave. */
export function diffMetrics(a: FlatMetrics, b: FlatMetrics, minRel = 0): readonly DiffRow[] {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  const rows: DiffRow[] = [];
  for (const key of keys) {
    const va = a[key] ?? 0;
    const vb = b[key] ?? 0;
    if (va === vb) continue;
    const delta = vb - va;
    const rel = va === 0 ? undefined : delta / Math.abs(va);
    if (rel !== undefined && Math.abs(rel) < minRel) continue;
    rows.push({ key, a: va, b: vb, delta, rel });
  }
  return rows;
}

export function diffReports(a: SimReport, b: SimReport, minRel = 0): readonly DiffRow[] {
  return diffMetrics(flattenMetrics(a), flattenMetrics(b), minRel);
}

function num(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(3);
}

export function relText(r: DiffRow): string {
  return r.rel === undefined ? "nuevo" : `${r.rel >= 0 ? "+" : ""}${(r.rel * 100).toFixed(1)} %`;
}

/** Tabla de texto para la consola. */
export function formatDiff(rows: readonly DiffRow[]): string {
  if (rows.length === 0) return "sin diferencias\n";
  const width = Math.max(...rows.map((r) => r.key.length));
  return `${rows
    .map((r) => `${r.key.padEnd(width)}  ${num(r.a)} -> ${num(r.b)}  (${relText(r)})`)
    .join("\n")}\n`;
}
