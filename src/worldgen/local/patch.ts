// El nivel 1 de una celda (planet-gen §Grilla): los hexes de la red fina que caen en la celda,
// con sus vecinos adentro y las celdas del planeta que tocan por afuera. Un hex se nombra por su
// id canónico en la red a frecuencia `n·k`, así dos celdas vecinas ven el mismo borde.

import { Lattice, type Planet, type Vec3 } from "../planet/index.ts";

/** Lado buscado de un hex del nivel 1, km (planet-gen: ~1-3 km). */
export const LOCAL_HEX_KM = 2;

/** El factor de subdivisión del planeta: fijo por planeta, así los ids finos son estables. */
export function localFactor(planet: Planet): number {
  return Math.max(1, Math.round(planet.kmPerHop / LOCAL_HEX_KM));
}

export interface LocalPatch {
  /** La celda del planeta (índice en la grilla). */
  readonly cell: number;
  readonly factor: number;
  readonly kmPerHex: number;
  /** Id canónico de cada hex en la red fina, en orden. El índice local es la posición acá. */
  readonly hexes: readonly number[];
  readonly centers: readonly Vec3[];
  /** Vecinos dentro de la celda, índices locales. */
  readonly neighbors: readonly (readonly number[])[];
  /** Celdas del planeta que el hex toca por afuera (vacío si es interior). */
  readonly outside: readonly (readonly number[])[];
}

export function localPatch(planet: Planet, cell: number): LocalPatch {
  const { grid } = planet;
  const factor = localFactor(planet);
  const fine = new Lattice(grid.lattice.n * factor);
  const children = grid.refine(cell, factor);
  const index = new Map(children.map((ch, i) => [ch.id, i]));
  const neighbors: number[][] = [];
  const outside: number[][] = [];
  for (const ch of children) {
    const inner: number[] = [];
    const out = new Set<number>();
    for (const nb of fine.neighborsAt(...ch.at)) {
      const i = index.get(nb.id);
      if (i !== undefined) inner.push(i);
      else out.add(grid.locate(fine.position(...nb.at), cell));
    }
    neighbors.push(inner);
    outside.push([...out].sort((a, b) => a - b));
  }
  return {
    cell,
    factor,
    kmPerHex: planet.kmPerHop / factor,
    hexes: children.map((ch) => ch.id),
    centers: children.map((ch) => ch.center),
    neighbors,
    outside,
  };
}
