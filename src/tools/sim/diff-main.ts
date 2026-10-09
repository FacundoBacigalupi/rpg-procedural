// `npm run sim:diff -- A.json B.json [--min-rel 0.05] [--html out.html]`: compara dos archivos de
// `npm run sim` (`sim-<seed>.json`) o de `sim:batch` (`batch.json`, se comparan las medias).

import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { diffMetrics, type FlatMetrics, flattenMetrics, formatDiff } from "./diff.ts";
import { renderDiffHtml } from "./html.ts";
import type { SimReport } from "./sim.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { "min-rel": { type: "string", default: "0" }, html: { type: "string" } },
});
const [fa, fb] = positionals;
if (!fa || !fb) throw new Error("uso: sim:diff A.json B.json [--min-rel N] [--html out.html]");

function load(file: string): FlatMetrics {
  const data = JSON.parse(readFileSync(file, "utf8")) as {
    summary?: Record<string, { mean: number }>;
  };
  if (data.summary) {
    return Object.fromEntries(Object.entries(data.summary).map(([k, s]) => [k, s.mean]));
  }
  return flattenMetrics(data as unknown as SimReport);
}

const rows = diffMetrics(load(fa), load(fb), Number(values["min-rel"]));
process.stdout.write(formatDiff(rows));
if (values.html) writeFileSync(values.html, renderDiffHtml(rows, fa, fb));
