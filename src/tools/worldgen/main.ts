// `npm run worldgen -- [--seed N] [--out maps] [--width 1024] [--frequency N]`: genera el planeta
// y deja un PNG por capa, `local.png` (la celda de la aldea a ~2 km por hex) y un `summary.json` con
// la cosmología, cifras, la celda de la aldea, sus anclas y su gente (la pre-corrida de family).

import { randomInt } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { EARTHLIKE_CLOCK, floorDiv } from "../../core/index.ts";
import { loadContentDir } from "../../persistence/index.ts";
import { CONTENT_KINDS, DEMOGRAPHY, TRAITS, villagePopulation } from "../../sim/index.ts";
import { BIOMES, generatePlanet, regionCell, villageSite } from "../../worldgen/index.ts";
import { renderLocal } from "./local.ts";
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

const content = loadContentDir("content", CONTENT_KINDS);
const started = performance.now();
const planet = generatePlanet({ seed, biomes: content.all(BIOMES), frequency });
const elapsed = performance.now() - started;
const site = villageSite(planet);
const village = site.cell;
const demography = content.get(DEMOGRAPHY, "human.preindustrial-village");
if (!demography) throw new Error("falta content/demography human.preindustrial-village");
const people = villagePopulation({ seed, site, traits: content.all(TRAITS), demography });

const dir = join(values.out, `seed-${seed}`);
mkdirSync(dir, { recursive: true });
const cells = pixelCells(planet.grid, width, width / 2);
for (const layer of LAYERS) {
  writeFileSync(
    join(dir, `${layer}.png`),
    encodePng(renderLayer(planet, layer, cells, width, village)),
  );
}
writeFileSync(join(dir, "local.png"), encodePng(renderLocal(site, width)));
const tr = site.terrain;
const summary = {
  ...planetSummary(planet),
  generationMs: Math.round(elapsed),
  village: {
    cell: regionCell(planet, village),
    hex: site.patch.hexes[site.hex],
    hexes: site.patch.hexes.length,
    kmPerHex: Math.round(site.patch.kmPerHex * 100) / 100,
    elevation: Math.round(tr.elevation[site.hex] as number),
    anchors: site.anchors.map((a) =>
      a.kind === "water"
        ? { kind: a.kind, source: a.source }
        : a.kind === "harbor"
          ? { kind: a.kind }
          : {
              kind: a.kind,
              hexes: a.hexes.length,
              ...(a.kind === "farmland" ? { yield: a.yield } : {}),
            },
    ),
  },
  people: populationSummary(),
};
writeFileSync(join(dir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(
  `${dir}: ${LAYERS.length + 1} mapas, ${planet.grid.size} celdas, ${Math.round(elapsed)} ms\n`,
);

function populationSummary() {
  const age = (born: number) => floorDiv(people.now - born, EARTHLIKE_CLOCK.year);
  const alive = people.people.filter((p) => p.end === null);
  const count = (kind: string) => people.events.filter((e) => e.kind === kind).length;
  const player = people.people.find((p) => p.id === people.player);
  const parent = (id: string | null | undefined) => {
    const p = people.people.find((x) => x.id === id);
    return p && { id: p.id, age: age(p.born), alive: p.end === null };
  };
  return {
    years: people.years,
    capacity: people.capacity,
    alive: alive.length,
    households: people.households.filter((h) => h.end === null).length,
    births: count("family.birth"),
    deaths: count("person.died"),
    arrived: count("person.arrived"),
    marriedOut: count("family.married_out"),
    ages: [0, 15, 30, 45, 60].map((from, i, xs) => ({
      from,
      n: alive.filter((p) => age(p.born) >= from && age(p.born) < (xs[i + 1] ?? 200)).length,
    })),
    player: player && {
      id: player.id,
      sex: player.sex,
      age: age(player.born),
      household: player.household,
      mother: parent(player.mother),
      father: parent(player.father),
      innate: player.innate,
    },
  };
}
