// Las armas como formas de objeto (combat §6, novel3-weapons-wire): lo que hace en una pelea un
// objeto con identidad según su forma (`ITEM_LOOK.shape`). El objeto ya existe (una herramienta de
// la casa, lo que da una secta); el catálogo solo dice cuánto alcanza, cuánto pesa y qué herida abre.

import { contentId, defineContent, z } from "../../core/index.ts";
import { WOUND_KINDS } from "../body/index.ts";
import type { FighterWeapon } from "./fight.ts";

export const WeaponDef = z.strictObject({
  id: contentId,
  /** La forma del objeto que sirve de arma (`ITEM_LOOK.shape`). */
  shape: z.string().min(1),
  /** Hasta dónde llega, metros. */
  reach: z.number().positive().max(4),
  /** kg. */
  mass: z.number().positive().max(10),
  wound: z.enum(WOUND_KINDS),
  /** 0-1: filo o punta nueva. */
  sharpness: z.number().min(0).max(1),
  /** Cuál prefiere quien lleva varias (más alto, primero). */
  rank: z.number().int().min(0),
  /** Lo que se ve del objeto (`ITEM_LOOK`) cuando una armería lo hace. */
  material: z.string().min(1),
  size: z.enum(["small", "medium", "large"]),
  /**
   * Si una secta la guarda en su armería y la canjea (novel3-weapons-sect): cuántos puntos de
   * contribución cuesta. Sin esto, no es arma de secta (un cuchillo, un hacha).
   */
  points: z.number().int().positive().optional(),
});
export type WeaponDef = z.infer<typeof WeaponDef>;
export const WEAPONS = defineContent("weapons", WeaponDef);

/** Las armas de la armería de una escuela: las de secta que no son de práctica (filo o punta). */
export function sectWeapons(weapons: readonly WeaponDef[]): readonly WeaponDef[] {
  return weapons.filter((w) => w.points !== undefined && w.wound !== "blunt");
}

/** El arma de la pelea desde su definición y el desgaste del objeto. */
export function fighterWeapon(def: WeaponDef, wear: number): FighterWeapon {
  return {
    reach: def.reach,
    mass: def.mass,
    wound: def.wound,
    sharpness: def.sharpness,
    wear: Math.min(1, Math.max(0, wear)),
  };
}
