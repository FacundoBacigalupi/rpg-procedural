// `npm run worldgen -- [--seed N] [--out maps] [--width 1024] [--frequency N]`: genera el planeta
// y deja un PNG por capa y un `summary.json` con la cosmología, cifras y la celda de la aldea.

import { randomInt } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { Rng } from "../../core/index.ts";
import { loadContentDir } from "../../persistence/index.ts";
import { BIOMES, generatePlanet, pickVillageSite, regionCell } from "../../worldgen/index.ts";
import { encodePng } from "./png.ts";
import { LAYERS, pixelCells, renderLayer } from "./render.ts";
import { planetSummary } from "./summary.ts";

const { values } = parseArgs({
  options: {
    seed: { type: "string" },
    out: { type: "string", default: "maps" },
    width: { type: "string", default: "1024" },
    frequency: { type: "string" },
  },
});

const seed = values.seed === undefined ? randomInt(0, 0xffffffff) : Number(values.seed);
if (!Number.isSafeInteger(seed) || seed < 0) throw new Error(`seed inválido: ${values.seed}`);
const width = Number(values.width);
const frequency = values.frequency === undefined ? undefined : Number(values.frequency);

const content = loadContentDir("content", [BIOMES]);
const started = performance.now();
const planet = generatePlanet({ seed, biomes: content.all(BIOMES), frequency });
const elapsed = performance.now() - started;
const village = pickVillageSite(planet, Rng.root(seed).fork("worldgen", "village").stream());

const dir = join(values.out, `seed-${seed}`);
mkdirSync(dir, { recursive: true });
const cells = pixelCells(planet.grid, width, width / 2);
for (const layer of LAYERS) {
  writeFileSync(
    join(dir, `${layer}.png`),
    encodePng(renderLayer(planet, layer, cells, width, village)),
  );
}
const summary = {
  ...planetSummary(planet),
  generationMs: Math.round(elapsed),
  village: regionCell(planet, village),
};
writeFileSync(join(dir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(
  `${dir}: ${LAYERS.length} mapas, ${planet.grid.size} celdas, ${Math.round(elapsed)} ms\n`,
);
