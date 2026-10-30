// La tierra que ve el ganado (livestock-milk-culture-terrain): qué parte de la tierra seca a un día
// de caminata de la aldea es quebrada (la pendiente que no se ara), de la que sale qué casas tienen
// cabras y cuáles bueyes (`LivestockDef.keeps`). Solo lee el terreno local.

import type { VillageSite } from "../../worldgen/index.ts";

/** Desde qué pendiente la tierra es quebrada: la misma que deja fuera de los campos (`site.ts`). */
const ROUGH_SLOPE = 0.1;
/** Hasta cuántos hexes se cuenta la tierra (≈ 2 km por hex): donde pasta el ganado de la casa. */
const HERD_RADIUS = 3;

/** Pura: la parte (0-1) de la tierra seca a `HERD_RADIUS` de la aldea con pendiente quebrada. */
export function roughShareOf(site: VillageSite): number {
  const { patch, terrain } = site;
  const seen = new Set<number>([site.hex]);
  let frontier = [site.hex];
  for (let k = 0; k < HERD_RADIUS; k++) {
    const next: number[] = [];
    for (const h of frontier) {
      for (const m of patch.neighbors[h] ?? []) {
        if (seen.has(m)) continue;
        seen.add(m);
        next.push(m);
      }
    }
    frontier = next;
  }
  const dry = [...seen].filter((h) => terrain.sea[h] !== 1 && terrain.lake[h] !== 1);
  if (dry.length === 0) return 0;
  return dry.filter((h) => (terrain.slope[h] ?? 0) >= ROUGH_SLOPE).length / dry.length;
}
