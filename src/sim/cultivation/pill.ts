// Las píldoras (novel2-pills-take, cultivation §6): un bien que se traga y lleva qi ya refinado. Las
// de reunir dan qi al recipiente (con su pureza; lo que no cabe se escapa al lugar); las de romper no
// dan qi: dejan una ayuda para la próxima ruptura que sube la preparación y cobra fundamento si
// rompe (la base apoyada en una píldora queda más floja). De dónde salen (la secta, el alquimista)
// es otro ítem; acá solo qué hace tragarlas. Los números de `content/pills/`, sin calibrar.

import { contentId, defineContent, z } from "../../core/index.ts";
import { mixedPurity } from "./absorb.ts";
import type { BreakAid } from "./meditation.ts";

export const PillDef = z
  .strictObject({
    id: contentId,
    /** El bien (`GoodDef.id`) que se gasta: una unidad por píldora. */
    good: contentId,
    effect: z.enum(["gather", "break"]),
    /** De reunir: qi que lleva cada una (la escala de la capacidad del primer tramo, 70-130). */
    qi: z.number().positive().optional(),
    /** Pureza (0-1) del qi que lleva o de la ayuda. */
    purity: z.number().min(0).max(1),
    /** De romper: lo que suma a la preparación del próximo intento. */
    prep: z.number().min(0).max(1).optional(),
    /** De romper: lo que resta a la calidad (el fundamento) si rompe con ella. */
    cost: z.number().min(0).max(1).optional(),
    /** Cuántas por cabeza trae el tesoro de una secta al llegar a la carne (novel2-pills-stock). */
    endowPerHead: z.number().min(0).optional(),
  })
  .refine((p) => (p.effect === "gather" ? p.qi !== undefined : p.prep !== undefined), {
    message: "una de reunir lleva qi; una de romper, prep",
  });
export type PillDef = z.infer<typeof PillDef>;
export const PILLS = defineContent("pills", PillDef);

/** Tragar una de reunir con `qi`/`purity` y el recipiente `capacity`: lo que queda y lo que se escapa. */
export function swallowGather(
  pill: PillDef,
  qi: number,
  purity: number,
  capacity: number,
): { qi: number; purity: number; taken: number; spilled: number } {
  const carried = pill.qi ?? 0;
  const room = Math.max(0, capacity - qi);
  const taken = round4(Math.min(room, carried));
  return {
    qi: round4(qi + taken),
    purity: mixedPurity(qi, purity, taken, pill.purity),
    taken,
    spilled: round4(carried - taken),
  };
}

/** La ayuda que deja una de romper; dos no se suman: queda la más fuerte. */
export function breakAidOf(pill: PillDef, prev: BreakAid | undefined): BreakAid {
  const prep = round4((pill.prep ?? 0) * (0.5 + 0.5 * pill.purity));
  const next = { prep, cost: pill.cost ?? 0, pill: pill.id };
  return prev && prev.prep >= prep ? prev : next;
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

/** Alguien tragó una píldora: qué hizo (qi tomado y escapado, o la ayuda que dejó). */
export const PILL_TAKEN_EVENT = "cultivation.pill_taken";
