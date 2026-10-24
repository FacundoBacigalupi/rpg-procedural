// Lo que el jugador sabe de su propia ropa (clothing-player-hud): qué tiene puesto, de abajo hacia
// arriba, si alguna prenda está gastada y si le alcanza para el aire de donde está (afuera el del
// día, adentro el de la casa). Lo leen la barra y el inventario. Puro: no escribe nada.

import { chooseGarments, wornGarment } from "../../sim/index.ts";
import { ambientOf } from "./ambient.ts";
import { seasonalClothing } from "./thermal.ts";
import { wardrobeOf } from "./wardrobe.ts";
import type { LifeWorld } from "./world.ts";

/** Desde qué desgaste una prenda se nota gastada. */
export const FRAYED_WEAR = 0.5;
/** Cuánto abrigo (clo) le falta para que lo note y para que sea mucho. */
export const SHORT_CLO = [0.25, 1] as const;

/** Lo que el jugador sabe de su ropa: qué tiene puesto (de abajo hacia arriba) y si le alcanza. */
export interface Outfit {
  readonly worn: readonly {
    readonly garment: string;
    readonly name: string;
    readonly frayed: boolean;
  }[];
  /** 0 le alcanza, 1 le falta algo de abrigo, 2 le falta mucho. */
  readonly short: 0 | 1 | 2;
}

/**
 * La ropa del jugador con el aire de donde está (afuera el del día, adentro el de la casa). Sin el
 * guardarropa encendido no hay prendas: `undefined`, y la ropa sigue siendo la estacional de siempre.
 */
export function outfitOf(w: LifeWorld): Outfit | undefined {
  if (w.wardrobe !== true || w.garments === undefined) return undefined;
  const airC = ambientOf(w)(w.truth, w.player)(w.scheduler.now);
  const wanted = seasonalClothing(airC).clo;
  const chosen = chooseGarments(wardrobeOf(w.truth, w.player, w.garments), wanted);
  const clo = chosen.reduce((s, g) => s + wornGarment(g).clo, 0);
  const missing = wanted - clo;
  return {
    worn: chosen.map((g) => ({
      garment: g.def.id,
      name: g.def.name,
      frayed: g.wear >= FRAYED_WEAR,
    })),
    short: missing >= SHORT_CLO[1] ? 2 : missing >= SHORT_CLO[0] ? 1 : 0,
  };
}
