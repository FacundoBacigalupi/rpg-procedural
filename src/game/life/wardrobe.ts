// La ropa de cada uno como prendas (body-health §7, clothing-garments): quien no tiene fila en
// `WARDROBE` tiene el juego básico de la aldea entero (las prendas `basic` del contenido); con fila,
// tiene esas prendas con su desgaste. Cada paso térmico se pone lo que pide el aire que ve
// (`seasonalClothing`) con lo que tiene (`chooseGarments`), y el abrigo es el de esas prendas
// (`dressed`): si no le alcanza, pasa frío. Opt-in (`LifeOptions.wardrobe`); apagado, la ropa es la
// de siempre (`seasonalClothing`). Puro: nadie escribe `WARDROBE` todavía (el desgaste, la compra y
// el oficio vienen después).

import type { AgentId } from "../../core/index.ts";
import {
  type Clothing,
  chooseGarments,
  dressed,
  type GarmentDef,
  type OwnedGarment,
  type ReadonlyWorldTruth,
  table,
  wornGarment,
} from "../../sim/index.ts";
import { seasonalClothing } from "./thermal.ts";

/** Una prenda que tiene alguien: el tipo (id del contenido) y su desgaste (0 entera, 1 deshecha). */
export interface WardrobeItem {
  readonly garment: string;
  readonly wear: number;
}

/** Las prendas de alguien. Sin fila, tiene el juego básico entero. */
export interface Wardrobe {
  readonly items: readonly WardrobeItem[];
}
export const WARDROBE = table<Wardrobe>("life.wardrobe");

/** Las prendas que tiene `who` (las de un tipo que el contenido no conoce se ignoran). */
export function wardrobeOf(
  truth: ReadonlyWorldTruth,
  who: AgentId,
  garments: readonly GarmentDef[],
): OwnedGarment[] {
  const row = truth.get(WARDROBE, who);
  if (!row) return garments.filter((g) => g.basic).map((def) => ({ def, wear: 0 }));
  const byId = new Map(garments.map((g) => [g.id, g]));
  return row.items.flatMap((i) => {
    const def = byId.get(i.garment);
    return def ? [{ def, wear: i.wear }] : [];
  });
}

/** La ropa que se pone quien tiene `owned` con el aire en `airC`. */
export function wardrobeClothing(owned: readonly OwnedGarment[], airC: number): Clothing {
  return dressed(chooseGarments(owned, seasonalClothing(airC).clo).map(wornGarment));
}
