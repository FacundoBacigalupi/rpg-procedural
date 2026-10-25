// Las prendas como contenido (body-health §7, ropa puesta como ítems): qué abriga cada una, cuánto
// frena el viento y cuánto cubre, en qué capa va y si es parte de lo que tiene cualquiera. Elegir
// qué ponerse es puro: las de abajo siempre (nadie anda desnudo), y encima se suman capas en orden
// hasta llegar al abrigo que pide el aire; una prenda gastada abriga menos. Sin RNG ni estado.

import { contentId, defineContent, z } from "../../core/index.ts";
import type { Garment } from "./thermal.ts";

export const GarmentDef = z.strictObject({
  id: contentId,
  name: z.string().min(1),
  /** Dónde va: `base` es la ropa de abajo (siempre puesta); las demás se suman con el frío. */
  slot: z.enum(["base", "body", "outer", "head", "hands", "feet"]),
  /** Orden en que se agrega encima de la base (menor primero). */
  layer: z.number().int().min(0),
  /** Aislamiento (clo) que suma entera. */
  clo: z.number().nonnegative().max(3),
  /** 0-1: cuánto frena el viento. */
  windproof: z.number().min(0).max(1),
  /** 0-1 del cuerpo que cubre. */
  coverage: z.number().min(0).max(1),
  /** De qué está hecha (para el desgaste, la compra y el oficio que vendrán). */
  material: z.string().min(1),
  /** Si es parte del juego de ropa que tiene cualquiera de la aldea. */
  basic: z.boolean().default(false),
  /** Días de uso diario (sin trabajo pesado) hasta deshacerse (clothing-wear, sin calibrar). */
  wearDays: z.number().positive().default(365),
});
export type GarmentDef = z.infer<typeof GarmentDef>;

export const GARMENTS = defineContent("garments", GarmentDef);

/** Una prenda que alguien tiene: de qué tipo y qué tan gastada (0 entera, 1 deshecha). */
export interface OwnedGarment {
  readonly def: GarmentDef;
  readonly wear: number;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const round = (x: number) => Math.round(x * 1e6) / 1e6;

/** Lo que aporta una prenda con su desgaste: abriga y frena el viento menos, cubre igual. */
export function wornGarment(g: OwnedGarment): Garment {
  const left = 1 - clamp01(g.wear);
  return {
    clo: round(g.def.clo * left),
    windproof: round(g.def.windproof * left),
    coverage: g.def.coverage,
  };
}

/**
 * Qué se pone quien tiene `owned` para un abrigo buscado de `wantedClo`: la base entera (aunque haga
 * calor) y encima, por capa y luego por id, las prendas que hagan falta hasta llegar. Una prenda
 * deshecha (`wear` 1) no se pone. Si no alcanza, se pone todo lo que tiene.
 */
export function chooseGarments(owned: readonly OwnedGarment[], wantedClo: number): OwnedGarment[] {
  const usable = owned
    .filter((g) => g.wear < 1)
    .sort(
      (a, b) =>
        a.def.layer - b.def.layer ||
        (a.def.id < b.def.id ? -1 : a.def.id > b.def.id ? 1 : a.wear - b.wear),
    );
  const base = usable.filter((g) => g.def.slot === "base");
  const extra = usable.filter((g) => g.def.slot !== "base");
  const chosen = [...base];
  let clo = chosen.reduce((s, g) => s + wornGarment(g).clo, 0);
  for (const g of extra) {
    if (clo >= wantedClo) break;
    chosen.push(g);
    clo += wornGarment(g).clo;
  }
  return chosen;
}
