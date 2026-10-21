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

/**
 * Abono de los campos (opt-in `fieldManure`, planet-gen §9): lo comido (sumidero `eaten`) deja desecho.
 * `EXCRETED` es la fuente del bien `MANURE_UNIT` (el cuerpo que digiere), `FIELD_MANURE` el sumidero
 * final (la tierra del campo, que lo toma como `afterManure`). El desecho espera en la cuenta de la aldea.
 */
export const EXCRETED = "excreted";
export const FIELD_MANURE = "field-manure";
export const MANURE_UNIT: LedgerUnit = ledgerUnit("good:manure");
/** Fracción en masa de lo comido (y de lo que el ganado y la fauna se llevan) que sale como desecho aprovechable. */
export const EXCRETED_FRACTION = 0.1;
/** Gramos de desecho que equivalen a una "unidad de abono" de `afterManure` sobre los campos agregados (calibración abierta). */
export const MANURE_GRAMS_PER_UNIT = 500_000;
/** Calidad del desecho mixto (heces humanas y de animales, sin curar): constante hasta que dependa de la dieta. */
export const MANURE_QUALITY = 0.4;

/** Calidad base del desecho de una dieta sin proteína (fibra y almidón: casi solo materia orgánica). */
export const MANURE_QUALITY_BASE = 0.25;
/** Cuánto suma cada gramo de proteína por gramo comido (el nitrógeno de la dieta sale en el desecho). */
export const MANURE_QUALITY_PER_PROTEIN = 1.5;
/** Techo de la calidad (una dieta de pura carne). */
export const MANURE_QUALITY_MAX = 0.8;

/**
 * Calidad del abono desde la dieta (planet-gen §9): el nitrógeno que come un cuerpo sale en lo que
 * deja, así que una dieta de carne y legumbres abona más que una de grano. Es el promedio de la
 * proteína por gramo, ponderado por la masa comida. Sin nada comido, la calidad mixta de siempre.
 */
export function manureQualityOf(
  diet: Iterable<{ readonly grams: number; readonly proteinPerGram: number }>,
): number {
  let mass = 0;
  let protein = 0;
  for (const d of diet) {
    if (!(d.grams > 0)) continue;
    mass += d.grams;
    protein += d.grams * d.proteinPerGram;
  }
  if (mass <= 0) return MANURE_QUALITY;
  return Math.min(
    MANURE_QUALITY_MAX,
    MANURE_QUALITY_BASE + (MANURE_QUALITY_PER_PROTEIN * protein) / mass,
  );
}
