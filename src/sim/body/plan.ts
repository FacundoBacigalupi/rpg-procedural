// El plan corporal como contenido (body-health §1) en su forma de tier 3: el cuerpo en zonas
// (cabeza, cuello, pecho, vientre, brazos, piernas), cada una con cuánto se expone a un golpe, qué
// funciones aporta, si es vital, cuán probable es que una herida le abra un vaso o le rompa el
// hueso y cuán sucia queda una herida ahí. La fisiología de referencia (sangre, gasto, reservas)
// es de la especie; el individuo la escala con su masa. Los alimentos dicen cuánta energía y agua
// da cada bien que se puede comer (lo que sale de recolectar, economy §2b).

import { contentId, defineContent, z } from "../../core/index.ts";

const Unit = z.number().min(0).max(1);

/** Las funciones de una zona (body-health §1, `BodyFunction`) que la Fase 1 lee. */
export const BODY_FUNCTIONS = [
  "locomotion",
  "manipulation",
  "strength",
  "speech",
  "consciousness",
  "breathing",
  "circulation",
  "sight",
  "hearing",
] as const;
export type BodyFunction = (typeof BODY_FUNCTIONS)[number];

const ZoneDef = z.strictObject({
  id: contentId,
  name: z.string().min(1),
  /** Peso relativo de recibir un golpe sin apuntar. */
  size: z.number().positive(),
  /** Cuánto de cada función pone esta zona (las de las zonas suman 1 o menos por función). */
  functions: z.partialRecord(z.enum(BODY_FUNCTIONS), z.number().positive().max(1)),
  /**
   * Destruirla mata: `brain` mata en el acto pasado `lethal` (y aturde antes); `organ` sangra por
   * dentro en proporción a la herida (se muere desangrado, más o menos rápido).
   */
  vital: z.strictObject({ kind: z.enum(["brain", "organ"]), lethal: Unit }).optional(),
  /** Chance de que una herida grave abra un vaso grande (sangrado arterial). */
  vessel: Unit,
  /** Chance de que un golpe fuerte rompa el hueso. */
  bone: Unit,
  /** Cuánta suciedad entra por una herida ahí (el vientre, por las tripas, mucho más). */
  contamination: Unit,
});
export type ZoneDef = z.infer<typeof ZoneDef>;

export const BodyPlanDef = z
  .strictObject({
    id: contentId,
    species: contentId,
    name: z.string().min(1),
    zones: z.array(ZoneDef).min(1),
    physiology: z.strictObject({
      /** Masa de un adulto de talla y constitución medias, en kg. */
      refMassKg: z.number().positive(),
      /** Litros de sangre por kg. */
      bloodPerKg: z.number().positive(),
      /** Gasto en reposo, kcal por kg y por día. */
      kcalPerKgDay: z.number().positive(),
      /** Agua que se pierde por día en reposo, en litros (la dieta y el clima la mueven). */
      waterPerDay: z.number().positive(),
      /** Reserva corta (glucógeno) llena, en kcal: se vacía en un día sin comer. */
      glycogenKcal: z.number().positive(),
      /** Fracción de grasa de un adulto bien comido. */
      fatFraction: Unit,
      /** Energía que el cuerpo puede sacar del músculo antes de morir de hambre, kcal. */
      muscleKcal: z.number().positive(),
      /** Fracción de la masa en agua perdida que mata. */
      lethalDehydration: Unit,
    }),
  })
  .superRefine((d, ctx) => {
    const ids = d.zones.map((zn) => zn.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", path: ["zones"], message: "zonas repetidas" });
    }
    for (const f of BODY_FUNCTIONS) {
      const sum = d.zones.reduce((s, zn) => s + (zn.functions[f] ?? 0), 0);
      if (sum > 1.0001) {
        ctx.addIssue({ code: "custom", path: ["zones"], message: `${f} suma ${sum} > 1` });
      }
    }
  });
export type BodyPlanDef = z.infer<typeof BodyPlanDef>;

export const BODY_PLANS = defineContent("body-plans", BodyPlanDef);

/**
 * Los micronutrientes que importan (body-health: pocos, cada uno con una carencia reconocible).
 * `dailyMg`: lo que un adulto necesita por día; `deficiency`: cómo se llama lo que pasa sin él.
 */
export const MICRONUTRIENTS = {
  vitaminC: { dailyMg: 75, deficiency: "escorbuto" },
  iron: { dailyMg: 14, deficiency: "anemia" },
  iodine: { dailyMg: 0.15, deficiency: "bocio" },
  vitaminA: { dailyMg: 0.8, deficiency: "ceguera nocturna" },
  thiamine: { dailyMg: 1.2, deficiency: "beriberi" },
  niacin: { dailyMg: 15, deficiency: "pelagra" },
  calcium: { dailyMg: 1000, deficiency: "raquitismo" },
} as const;
export type Micronutrient = keyof typeof MICRONUTRIENTS;
const MICRONUTRIENT_IDS = Object.keys(MICRONUTRIENTS) as [Micronutrient, ...Micronutrient[]];

export const FOOD_CATEGORIES = [
  "cereal",
  "tuber",
  "legume",
  "fruit",
  "vegetable",
  "meat",
  "fish",
  "dairy",
  "egg",
  "sweet",
  "condiment",
  "drink",
  "wild",
] as const;
export type FoodCategory = (typeof FOOD_CATEGORIES)[number];

export const SEASONS = ["spring", "summer", "autumn", "winter"] as const;
export type FoodSeason = (typeof SEASONS)[number];

export const FoodDef = z
  .strictObject({
    /** El id del bien (el mismo que nombran los `yields` de los verbos). */
    id: contentId,
    name: z.string().min(1),
    category: z.enum(FOOD_CATEGORIES).default("wild"),
    kcalPerGram: z.number().min(0),
    /** Litros de agua por gramo. */
    waterPerGram: z.number().min(0).max(1),
    /** Gramos de proteína y de grasa por gramo de comida. */
    proteinPerGram: z.number().min(0).max(1).default(0),
    fatPerGram: z.number().min(0).max(1).default(0),
    /** Miligramos de cada micronutriente por 100 g. */
    micronutrients: z.partialRecord(z.enum(MICRONUTRIENT_IDS), z.number().positive()).default({}),
    /** Estaciones en que se consigue fresca; vacío = todo el año (almacenada o de cría). */
    seasons: z.array(z.enum(SEASONS)).default([]),
    /** Biomas donde se da; vacío = donde se la cultive o lleve el comercio. */
    biomes: z.array(contentId).default([]),
  })
  .superRefine((f, ctx) => {
    if (f.proteinPerGram + f.fatPerGram + f.waterPerGram > 1.0001) {
      ctx.addIssue({ code: "custom", message: "proteína + grasa + agua pasan de 1 g por g" });
    }
    // 4 kcal/g de proteína y de lo que queda (hidratos, fibra), 9 de grasa.
    const rest = Math.max(0, 1 - f.waterPerGram - f.proteinPerGram - f.fatPerGram);
    const ceiling = 4 * f.proteinPerGram + 9 * f.fatPerGram + 4 * rest;
    if (f.kcalPerGram > ceiling + 0.01) {
      ctx.addIssue({
        code: "custom",
        path: ["kcalPerGram"],
        message: `${f.kcalPerGram} kcal/g pasa del máximo ${ceiling.toFixed(2)} que dan sus macros`,
      });
    }
    if (new Set(f.seasons).size !== f.seasons.length) {
      ctx.addIssue({ code: "custom", path: ["seasons"], message: "estaciones repetidas" });
    }
  });
export type FoodDef = z.infer<typeof FoodDef>;

export const FOODS = defineContent("foods", FoodDef, (f) =>
  f.biomes.map((id, n) => ({ kind: "biomes", id, at: `biomes.${n}` })),
);

/** Las zonas de un plan, por id. */
export function zoneOf(plan: BodyPlanDef, id: string): ZoneDef {
  const zone = plan.zones.find((zn) => zn.id === id);
  if (!zone) throw new RangeError(`${plan.id} no tiene la zona ${id}`);
  return zone;
}
