// Las píldoras (novel2-pills-take, cultivation §6): un bien que se traga y lleva qi ya refinado. Las
// de reunir dan qi al recipiente (con su pureza; lo que no cabe se escapa al lugar); las de romper no
// dan qi: dejan una ayuda para la próxima ruptura que sube la preparación y cobra fundamento si
// rompe (la base apoyada en una píldora queda más floja). De dónde salen (la secta, el alquimista)
// es otro ítem; acá solo qué hace tragarlas. Los números de `content/pills/`, sin calibrar.

import { contentId, defineContent, type Random, z } from "../../core/index.ts";
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
    /** Cuántos puntos de contribución pide la secta por una (novel2-pills-exchange); sin él, no la canjea. */
    points: z.number().positive().optional(),
    /** Cómo se refina (novel2-alch-refine): de qué hierba (`HerbDef.id`) y cuántos gramos por píldora. */
    recipe: z.strictObject({ herb: contentId, grams: z.number().positive() }).optional(),
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

/** Lo que sale como mínimo y como máximo de cada intento según la mano (0-1) del alquimista. */
export const REFINE_ODDS = [0.2, 0.9] as const;

/** Una tanda de refinado: cuántos intentos, cuántas píldoras salieron y los gramos que se usaron. */
export interface RefineBatch {
  readonly attempts: number;
  readonly made: number;
  readonly used: number;
}

/**
 * Refinar `grams` de la hierba de la receta de `pill` (novel2-alch-refine, crafts §4): cada intento
 * lleva `recipe.grams`; sale con una chance que crece con la mano (`hand`, 0-1) del alquimista; lo
 * que falla se quema (los gramos se usan igual). Sin receta o sin gramos para un intento, nada.
 */
export function refineBatch(pill: PillDef, grams: number, hand: number, rng: Random): RefineBatch {
  const per = pill.recipe?.grams;
  if (per === undefined) return { attempts: 0, made: 0, used: 0 };
  const attempts = Math.floor(Math.max(0, grams) / per);
  if (attempts === 0) return { attempts: 0, made: 0, used: 0 };
  const [lo, hi] = REFINE_ODDS;
  const odds = lo + (hi - lo) * Math.min(1, Math.max(0, hand));
  return { attempts, made: rng.binomial(attempts, odds), used: attempts * per };
}

/** Alguien tragó una píldora: qué hizo (qi tomado y escapado, o la ayuda que dejó). */
export const PILL_TAKEN_EVENT = "cultivation.pill_taken";

/** Por qué la secta no da la píldora pedida (novel2-pills-exchange). */
export type PillRefusal = "not_member" | "no_pill" | "no_stock" | "no_points";

/**
 * Canjear puntos por una píldora del tesoro: la pide quien es de la secta (`member`), la secta la
 * vende por puntos (`PillDef.points`; sin ellos no la canjea), tiene que haber (`stock`) y alcanzar.
 */
export function pillExchange(
  pill: PillDef | undefined,
  member: boolean,
  points: number,
  stock: number,
): { kind: "given"; cost: number } | { kind: "refused"; refused: PillRefusal } {
  if (!member) return { kind: "refused", refused: "not_member" };
  if (!pill || pill.points === undefined) return { kind: "refused", refused: "no_pill" };
  if (stock < 1) return { kind: "refused", refused: "no_stock" };
  if (pill.points > points) return { kind: "refused", refused: "no_points" };
  return { kind: "given", cost: pill.points };
}
