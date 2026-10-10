// Las recetas como contenido (crafts §9): qué insumos pide un proceso, qué sale y qué calor hace
// falta para que salga. Una receta es lo que se cree que hay que hacer; lo que sale lo calcula la
// sesión (`session.ts`) con la mano del artesano. Los insumos y el producto son bienes de
// `content/goods/`: el que cocina gasta lo uno y recibe lo otro por el ledger.

import { contentId, defineContent, z } from "../../core/index.ts";

export const CRAFT_KINDS = ["cooking"] as const;
export type CraftKind = (typeof CRAFT_KINDS)[number];

export const RecipeDef = z
  .strictObject({
    id: contentId,
    name: z.string().min(1),
    craft: z.enum(CRAFT_KINDS),
    /** Lo que se gasta por tanda, en gramos. */
    inputs: z.array(z.strictObject({ good: contentId, grams: z.number().int().positive() })).min(1),
    /**
     * Lo que sale: gramos de producto por gramo de insumo con la tanda en su punto. El agua que
     * absorbe la masa no se cuenta en el ledger todavía (weather §4), por eso puede pasar de 1.
     */
    output: z.strictObject({ good: contentId, ratio: z.number().positive() }),
    /** Amasar y preparar el fuego antes de que empiece la cocción. */
    prepMinutes: z.number().positive(),
    /** Opt-in: `Essence` por gramo y pureza base del producto (píldoras); ver `pillOf`. */
    pill: z
      .strictObject({
        essence: z.number().positive(),
        purity: z.number().min(0).max(1),
      })
      .optional(),
    /**
     * El calor (°C): `target` es el que pide la receta, `minutes` lo que tarda en estar a punto a
     * esa temperatura, y por encima de `scorchAt` lo de afuera se quema antes que lo de adentro.
     */
    heat: z.strictObject({
      target: z.number().positive(),
      minutes: z.number().positive(),
      scorchAt: z.number().positive(),
    }),
  })
  .superRefine((r, ctx) => {
    if (r.heat.scorchAt <= r.heat.target) {
      ctx.addIssue({
        code: "custom",
        path: ["heat", "scorchAt"],
        message: "quema antes del punto",
      });
    }
    const goods = r.inputs.map((i) => i.good);
    if (new Set(goods).size !== goods.length) {
      ctx.addIssue({ code: "custom", path: ["inputs"], message: "insumos repetidos" });
    }
  });
export type RecipeDef = z.infer<typeof RecipeDef>;

export const RECIPES = defineContent("recipes", RecipeDef, (r) => [
  ...r.inputs.map((i, n) => ({ kind: "goods", id: i.good, at: `inputs.${n}.good` })),
  { kind: "goods", id: r.output.good, at: "output.good" },
]);

/**
 * Lo que la alquimia escribe en lo producido (body-health §9, crafts §4): `Essence` por gramo
 * de producto y pureza base de la receta (0-1) con la tanda en su punto. La mano que la hizo la
 * baja: tanda mal llevada, más tensión residual. Sin `pill` la receta no deja esencia.
 */
export interface PillSpec {
  readonly essence: number;
  readonly purity: number;
}

/** `Essence` por gramo y pureza de lo que salió con `quality` (0-1): la pureza baja hasta la mitad con la calidad. */
export function pillOf(
  pill: PillSpec | undefined,
  quality: number,
): { readonly essence: number; readonly purity: number } | undefined {
  if (!pill || !(pill.essence > 0)) return undefined;
  const q = quality < 0 ? 0 : quality > 1 ? 1 : quality;
  const p = pill.purity < 0 ? 0 : pill.purity > 1 ? 1 : pill.purity;
  return { essence: pill.essence, purity: p * (0.5 + 0.5 * q) };
}
