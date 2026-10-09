// Reporte HTML de la sim headless (tooling §6): una página sola, sin scripts, que se lee en el
// navegador. Barras proporcionales por métrica y la tabla de diferencias entre dos corridas.

import { type DiffRow, flattenMetrics, relText } from "./diff.ts";
import type { SimReport } from "./sim.ts";

export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const STYLE =
  "body{font:14px system-ui;margin:2rem;background:#fff;color:#111}table{border-collapse:collapse}" +
  "td,th{padding:2px 10px;text-align:left}td.n{text-align:right;font-variant-numeric:tabular-nums}" +
  ".bar{display:inline-block;height:10px;background:#47a}.up{color:#a30}.down{color:#07a}" +
  "@media(prefers-color-scheme:dark){body{background:#181818;color:#eee}.bar{background:#8ac}}";

function page(title: string, body: string): string {
  return (
    `<!doctype html>\n<html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"><style>${STYLE}</style></head>` +
    `<body>${body}</body></html>\n`
  );
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(3);
}

/** Reporte de una corrida: cabecera y una fila con barra por métrica (barra relativa al máximo del grupo). */
export function renderSimHtml(report: SimReport): string {
  const groups = new Map<string, [string, number][]>();
  for (const [key, value] of Object.entries(flattenMetrics(report))) {
    const group = key.includes(".") ? key.split(".").slice(0, 2).join(".") : "general";
    const list = groups.get(group) ?? [];
    list.push([key, value]);
    groups.set(group, list);
  }
  const sections = [...groups]
    .map(([group, rows]) => {
      const max = Math.max(1, ...rows.map(([, v]) => Math.abs(v)));
      const trs = rows
        .map(
          ([k, v]) =>
            `<tr><td>${escapeHtml(k)}</td><td class="n">${fmt(v)}</td>` +
            `<td><span class="bar" style="width:${Math.round((Math.abs(v) / max) * 160)}px"></span></td></tr>`,
        )
        .join("");
      return `<h2>${escapeHtml(group)}</h2><table>${trs}</table>`;
    })
    .join("");
  const head =
    `<h1>Seed ${report.seed}</h1><p>${report.years} años, ${report.checks} chequeos` +
    `${report.stoppedEarly ? ", <b>detenida por un invariante</b>" : ""}. ` +
    `Hash: <code>${escapeHtml(String(report.hash))}</code></p>`;
  return page(`Sim seed ${report.seed}`, head + sections);
}

/** Tabla de diferencias A -> B. */
export function renderDiffHtml(rows: readonly DiffRow[], labelA = "A", labelB = "B"): string {
  const trs = rows
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r.key)}</td><td class="n">${fmt(r.a)}</td><td class="n">${fmt(r.b)}</td>` +
        `<td class="n ${r.delta > 0 ? "up" : "down"}">${relText(r)}</td></tr>`,
    )
    .join("");
  const table =
    rows.length === 0
      ? "<p>Sin diferencias.</p>"
      : `<table><tr><th>métrica</th><th>${escapeHtml(labelA)}</th><th>${escapeHtml(labelB)}</th><th>cambio</th></tr>${trs}</table>`;
  return page("Diferencias entre corridas", `<h1>Diferencias</h1>${table}`);
}
