// Los bienes y la moneda como contenido (economy §1, §2): qué unidad del ledger es cada uno, cuánto
// vale a ojo (el precio que alguien cree al empezar, no un precio del mundo: economy, principio 3)
// y cuánto tarda en pudrirse. La moneda de la aldea es el cobre, que existe como piezas contadas.

import { contentId, defineContent, type LedgerUnit, ledgerUnit, z } from "../../core/index.ts";

export const GoodDef = z
  .strictObject({
    id: contentId,
    name: z.string().min(1),
    /** `coin`: piezas contadas; `good`: gramos. */
    form: z.enum(["good", "coin"]),
    /** Lo que se paga por kilo según la creencia de arranque (monedas de cobre). */
    priceCopperPerKg: z.number().positive().optional(),
    /** Días en que la mitad se echa a perder, guardado como se guarda en una casa de aldea. */
    halfLifeDays: z.number().positive().optional(),
  })
  .superRefine((g, ctx) => {
    if (g.form === "coin" && (g.priceCopperPerKg !== undefined || g.halfLifeDays !== undefined)) {
      ctx.addIssue({ code: "custom", message: "una moneda no tiene precio por kilo ni se pudre" });
    }
    if (g.form === "good" && g.priceCopperPerKg === undefined) {
      ctx.addIssue({ code: "custom", path: ["priceCopperPerKg"], message: "falta el precio" });
    }
  });
export type GoodDef = z.infer<typeof GoodDef>;

export const GOODS = defineContent("goods", GoodDef);

/** La unidad del ledger de un bien o moneda. */
export function goodUnit(g: Pick<GoodDef, "id" | "form">): LedgerUnit {
  return ledgerUnit(`${g.form === "coin" ? "coin" : "good"}:${g.id}`);
}

/** La moneda de la aldea: piezas de cobre. */
export const COPPER: LedgerUnit = ledgerUnit("coin:copper");

/** De dónde sale lo que se cosecha y adónde va lo que se pudre (fuente y sumidero del ledger). */
export const HARVEST = "harvest";
export const ROTTED = "rotted";

/** Lo que rinde el campo (calibración abierta: ROADMAP Hito 1c; después, por estación y suelo). */
export const HARVEST_GOOD: LedgerUnit = ledgerUnit("good:grain");
/** Gramos de grano por hora de trabajo medio en el campo. */
export const HARVEST_GRAMS_PER_HOUR = 110;
