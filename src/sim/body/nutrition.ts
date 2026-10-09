// Nutrientes crÃ³nicos y calidad del agua (body-health Â§5), parte pura: cada alimento aporta
// micronutrientes por kilo; el cuerpo guarda reservas que se vacÃ­an a ritmo propio cuando la dieta
// no alcanza (semanas a meses) y las carencias dan sÃ­ntomas lentos (escorbuto, anemia, raquitismo,
// bocio, desnutriciÃ³n proteica). El agua lleva una carga de patÃ³geno (la de `WELL_TAINT`) y una
// turbiedad, y de ahÃ­ sale la dosis por litro. Sin IO ni estado: el cableado a `Body`, a la
// despensa y al pozo queda aparte. Constantes sin calibrar.

import { contentId, defineContent, z } from "../../core/index.ts";
import { table } from "../world/index.ts";

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

export type Nutrient = "protein" | "vitaminC" | "iodine" | "iron" | "vitaminD";

export const BODY_NUTRIENTS: readonly Nutrient[] = [
  "protein",
  "vitaminC",
  "iodine",
  "iron",
  "vitaminD",
];

/** Lo que aporta un kilo de alimento, en unidades de necesidad diaria de un adulto (1 = cubre un dÃ­a). */
export type NutrientProfile = Readonly<Partial<Record<Nutrient, number>>>;

/** Necesidad diaria de un adulto (g de proteÃ­na; el resto en unidades abstractas = 1 por dÃ­a). */
export const DAILY_NEED: Readonly<Record<Nutrient, number>> = {
  protein: 55,
  vitaminC: 1,
  iodine: 1,
  iron: 1,
  vitaminD: 1,
};

/** DÃ­as de reserva con que arranca un cuerpo sano y que no se pasan de ahÃ­. */
export const STORE_DAYS: Readonly<Record<Nutrient, number>> = {
  protein: 30,
  vitaminC: 60,
  iodine: 120,
  iron: 300,
  vitaminD: 180,
};

/** Reservas en dÃ­as de necesidad cubierta (0 = agotada). */
export type NutrientStores = Readonly<Record<Nutrient, number>>;

export function fullStores(): NutrientStores {
  return { ...STORE_DAYS };
}

/**
 * Un dÃ­a de dieta: `intake` es lo ingerido (en las mismas unidades que `DAILY_NEED`), `need` el
 * multiplicador de necesidad (niÃ±o creciendo, embarazo, sangrado, esfuerzo: > 1). Si se cubre,
 * la reserva se rellena a razÃ³n de 1 dÃ­a por dÃ­a extra de excedente; si no, se gasta el faltante.
 */
export function stepStores(
  stores: NutrientStores,
  intake: Readonly<Record<Nutrient, number>>,
  need = 1,
): NutrientStores {
  const out = { ...stores };
  for (const n of BODY_NUTRIENTS) {
    const required = DAILY_NEED[n] * need;
    // Balance en dÃ­as: +1 = un dÃ­a entero de excedente, -1 = un dÃ­a entero sin nada.
    const balance = (intake[n] - required) / DAILY_NEED[n];
    out[n] = Math.max(0, Math.min(STORE_DAYS[n], stores[n] + balance));
  }
  return out;
}

/** Aporte diario de una dieta: lista de (kilos, perfil por kilo). */
export function dietIntake(
  items: readonly { readonly kg: number; readonly profile: NutrientProfile }[],
): Record<Nutrient, number> {
  const t: Record<Nutrient, number> = {
    protein: 0,
    vitaminC: 0,
    iodine: 0,
    iron: 0,
    vitaminD: 0,
  };
  for (const it of items) for (const n of BODY_NUTRIENTS) t[n] += it.kg * (it.profile[n] ?? 0);
  return t;
}

/** Carencia 0-1: 0 con la reserva a mÃ¡s de un cuarto, creciendo a 1 con la reserva agotada. */
export function deficiency(stores: NutrientStores, n: Nutrient): number {
  const cut = STORE_DAYS[n] * 0.25;
  return clamp01(1 - stores[n] / cut);
}

export type DeficiencyDisease = "protein_malnutrition" | "scurvy" | "goiter" | "anemia" | "rickets";

const DISEASE_OF: Readonly<Record<Nutrient, DeficiencyDisease>> = {
  protein: "protein_malnutrition",
  vitaminC: "scurvy",
  iodine: "goiter",
  iron: "anemia",
  vitaminD: "rickets",
};

/** QuÃ© mal produce la falta de cada nutriente. */
export function deficiencyDisease(n: Nutrient): DeficiencyDisease {
  return DISEASE_OF[n];
}

/** Lo que una carencia le hace al cuerpo (factores 0-1 que las demÃ¡s capas leen). */
export interface DeficiencyEffects {
  /** Multiplicador de la velocidad de curaciÃ³n (1 = normal). */
  readonly healing: number;
  /** Probabilidad extra diaria de que una herida vieja se reabra. */
  readonly reopenWound: number;
  /** Multiplicador de fuerza y aguante. */
  readonly vigor: number;
  /** Multiplicador de la defensa inmune. */
  readonly immune: number;
  /** Multiplicador del crecimiento (niÃ±os). */
  readonly growth: number;
  /** Multiplicador de cogniciÃ³n. */
  readonly cognition: number;
  /** FracciÃ³n de capacidad de carga de sangre/oxÃ­geno que se pierde (anemia). */
  readonly oxygen: number;
}

export const NO_DEFICIENCY: DeficiencyEffects = {
  healing: 1,
  reopenWound: 0,
  vigor: 1,
  immune: 1,
  growth: 1,
  cognition: 1,
  oxygen: 0,
};

/** Efectos sumados de todas las carencias actuales. */
export function deficiencyEffects(stores: NutrientStores): DeficiencyEffects {
  const p = deficiency(stores, "protein");
  const c = deficiency(stores, "vitaminC");
  const i = deficiency(stores, "iodine");
  const fe = deficiency(stores, "iron");
  const d = deficiency(stores, "vitaminD");
  return {
    healing: (1 - 0.6 * p) * (1 - 0.5 * c),
    reopenWound: 0.05 * c,
    vigor: (1 - 0.3 * p) * (1 - 0.5 * fe) * (1 - 0.2 * c),
    immune: (1 - 0.3 * p) * (1 - 0.2 * fe) * (1 - 0.2 * c),
    growth: (1 - 0.5 * p) * (1 - 0.6 * d),
    cognition: 1 - 0.5 * i,
    oxygen: 0.6 * fe,
  };
}

/** Etapa observable de un mal de carencia, para `bodySigns`: nada, incipiente, franca, grave. */
export function deficiencyStage(
  stores: NutrientStores,
  n: Nutrient,
): "none" | "early" | "overt" | "severe" {
  const d = deficiency(stores, n);
  return d < 0.15 ? "none" : d < 0.5 ? "early" : d < 0.85 ? "overt" : "severe";
}

/** El agua que se toma: carga de patÃ³geno (0-1, la de `WELL_TAINT`), turbiedad, y si se la tratÃ³. */
export interface WaterQuality {
  readonly load: number;
  /** 0-1: barro y partÃ­culas; no enferma por sÃ­ misma pero esconde la carga y sabe mal. */
  readonly turbidity: number;
  /** 0-1: cuÃ¡nta de la carga quitÃ³ el hervor o el filtrado. */
  readonly treated: number;
  /** 0-1: sales y minerales disueltos que la hacen no potable (mar, pantano salobre). */
  readonly salinity: number;
}

export const CLEAN_WATER: WaterQuality = { load: 0, turbidity: 0, treated: 0, salinity: 0 };

/** Carga efectiva tras el tratamiento. */
export function effectiveLoad(w: WaterQuality): number {
  return clamp01(w.load * (1 - clamp01(w.treated)));
}

/** Dosis de patÃ³geno por litro (0-1) para el contagio por la ruta `water`. */
export function waterDose(w: WaterQuality): number {
  return effectiveLoad(w);
}

/** Lo que el agua hace sin patÃ³geno: la salinidad deshidrata (cuenta como agua que se pierde). */
export function netHydration(liters: number, w: WaterQuality): number {
  return liters * (1 - 1.5 * clamp01(w.salinity));
}

/** QuÃ© tan bien se nota que el agua estÃ¡ mala: 0 (no se nota) a 1 (obvia); la turbiedad y la sal avisan, la carga sola no. */
export function waterWarning(w: WaterQuality): number {
  return clamp01(0.7 * w.turbidity + 0.9 * w.salinity + 0.2 * effectiveLoad(w));
}

/** El agua de un pozo con la carga de `WELL_TAINT` (sin turbiedad ni tratamiento ni sal). */
export function wellWater(load: number): WaterQuality {
  return { ...CLEAN_WATER, load: clamp01(load) };
}

/**
 * Las reservas de una persona, aparte del `Body`. Sin fila, las reservas están llenas: solo se
 * guardan mientras alguna está por debajo de lo lleno.
 */
export interface PersonNutrition {
  readonly stores: NutrientStores;
  /** Hasta cuándo está calculado. */
  readonly at: number;
}
export const NUTRITION = table<PersonNutrition>("body.nutrition");

const Need = z.number().min(0).max(1000);
const PerNutrient = z.strictObject({
  protein: Need.optional(),
  vitaminC: Need.optional(),
  iodine: Need.optional(),
  iron: Need.optional(),
  vitaminD: Need.optional(),
});

/** Perfil de nutrientes por kilo de un alimento (el `id` es el del `FoodDef`). */
export const NutrientProfileDef = z.strictObject({
  id: contentId,
  perKg: PerNutrient,
});
export type NutrientProfileDef = z.infer<typeof NutrientProfileDef>;
export const NUTRIENT_PROFILES = defineContent("nutrient-profiles", NutrientProfileDef, (p) => [
  { kind: "foods", id: p.id, at: "id" },
]);

/** Una dieta de referencia: qué come por día quien vive de ella, y lo que no es comida (el sol). */
export const DietDef = z.strictObject({
  id: contentId,
  name: z.string().min(1),
  items: z.array(z.strictObject({ food: contentId, kg: z.number().positive().max(5) })).min(1),
  background: PerNutrient.default({}),
});
export type DietDef = z.infer<typeof DietDef>;
export const DIETS = defineContent("diets", DietDef, (d) =>
  d.items.map((it, n) => ({ kind: "foods", id: it.food, at: `items.${n}.food` })),
);

/** El aporte diario de una dieta con los perfiles dados (alimento sin perfil aporta nada). */
export function dietDayIntake(
  diet: DietDef,
  profiles: ReadonlyMap<string, NutrientProfile>,
): Record<Nutrient, number> {
  const t = dietIntake(
    diet.items.map((it) => ({ kg: it.kg, profile: profiles.get(it.food) ?? {} })),
  );
  for (const n of BODY_NUTRIENTS) t[n] += diet.background[n] ?? 0;
  return t;
}

/**
 * Lo que una persona comió en un día de mundo, por bien y en gramos. Lo escriben quienes comen
 * (`act`, `routine`) y lo lee el paso diario de nutrición; nadie lo borra: el día siguiente lo
 * reemplaza. Aparte de `NUTRITION` para no mezclar escritores.
 */
export interface MealLog {
  readonly day: number;
  readonly eaten: Readonly<Record<string, number>>;
}
export const MEALS = table<MealLog>("body.meals");

/** Suma una comida al registro del día (si el registro es de otro día, empieza uno nuevo). */
export function logMeal(
  prev: MealLog | undefined,
  day: number,
  good: string,
  grams: number,
): MealLog {
  const base = prev && prev.day === day ? prev.eaten : {};
  return { day, eaten: { ...base, [good]: (base[good] ?? 0) + grams } };
}

/** Aporte de nutrientes de lo comido (perfiles por kilo; lo que no tiene perfil no aporta). */
export function mealIntake(
  log: MealLog,
  profiles: ReadonlyMap<string, NutrientProfile>,
): Record<Nutrient, number> {
  return dietIntake(
    Object.keys(log.eaten)
      .sort()
      .map((good) => ({ kg: (log.eaten[good] ?? 0) / 1000, profile: profiles.get(good) ?? {} })),
  );
}

/** Lo que hace crecer la necesidad de nutrientes (`stepStores`' `need`). */
export interface NeedFactors {
  readonly ageYears: number;
  readonly pregnant?: boolean;
  /** 0-1: esfuerzo físico del día. */
  readonly strain?: number;
  /** Heridas abiertas o sangrando (cuenta, no gravedad). */
  readonly openWounds?: number;
}

/** Multiplicador de necesidad: niños y adolescentes creciendo, embarazo, esfuerzo y heridas. */
export function needMultiplier(f: NeedFactors): number {
  const growing =
    f.ageYears < 4 ? 0.6 : f.ageYears < 18 ? 1.3 - 0.3 * clamp01((f.ageYears - 4) / 14) : 1;
  const wounds = 0.05 * Math.min(4, f.openWounds ?? 0);
  return growing + (f.pregnant ? 0.4 : 0) + 0.3 * clamp01(f.strain ?? 0) + wounds;
}

/**
 * Efectos de las carencias que ya importan (etapa franca o peor); `undefined` si ninguna llegó
 * ahí, para no guardar nada en el caso normal.
 */
export function seriousDeficiencyEffects(stores: NutrientStores): DeficiencyEffects | undefined {
  const serious = BODY_NUTRIENTS.some((n) => deficiency(stores, n) >= 0.5);
  return serious ? deficiencyEffects(stores) : undefined;
}

/** Los efectos publicados de quien tiene alguna carencia seria; sin fila, ninguno. */
export const DEFICIENCY_EFFECTS = table<DeficiencyEffects>("body.deficiency_effects");
