// Cifras del planeta para mirar de un vistazo si salió sano (planet-gen §6).

import type { Planet } from "../../worldgen/index.ts";

export function planetSummary(planet: Planet) {
  const { grid, tectonics: t, climate: cl, hydrology: hy } = planet;
  const biomes = new Map<string, number>();
  let landArea = 0;
  let landT = 0;
  let landP = 0;
  let rivers = 0;
  let lakes = 0;
  let volcanoes = 0;
  for (let c = 0; c < grid.size; c++) {
    const a = grid.areas[c] as number;
    const id = planet.biomes[planet.biome[c] as number]?.id ?? "?";
    biomes.set(id, (biomes.get(id) ?? 0) + a);
    if (t.volcanic[c]) volcanoes++;
    if ((t.elevation[c] as number) <= 0) continue;
    landArea += a;
    landT += a * (cl.temperature[c] as number);
    landP += a * (cl.precipitation[c] as number);
    if (hy.river[c]) rivers++;
    if (hy.lake[c]) lakes++;
  }
  const round = (x: number, d = 1) => Math.round(x * 10 ** d) / 10 ** d;
  return {
    seed: planet.seed,
    cosmology: planet.cosmology,
    cells: grid.size,
    frequency: grid.lattice.n,
    kmPerHop: round(planet.kmPerHop),
    plates: t.plateCount,
    landFraction: round(t.landFraction, 3),
    landMeanTemperature: round(landT / landArea),
    landMeanPrecipitation: Math.round(landP / landArea),
    riverCells: rivers,
    lakeCells: lakes,
    volcanoes,
    events: planet.events.length,
    biomeArea: Object.fromEntries(
      [...biomes.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, round(v, 4)]),
    ),
  };
}
