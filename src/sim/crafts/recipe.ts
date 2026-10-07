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
