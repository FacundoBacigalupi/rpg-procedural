// Nutrientes crÃ³nicos y calidad del agua (body-health Â§5), parte pura: cada alimento aporta
// micronutrientes por kilo; el cuerpo guarda reservas que se vacÃ­an a ritmo propio cuando la dieta
// no alcanza (semanas a meses) y las carencias dan sÃ­ntomas lentos (escorbuto, anemia, raquitismo,
// bocio, desnutriciÃ³n proteica). El agua lleva una carga de patÃ³geno (la de `WELL_TAINT`) y una
// turbiedad, y de ahÃ­ sale la dosis por litro. Sin IO ni estado: el cableado a `Body`, a la
// despensa y al pozo queda aparte. Constantes sin calibrar.

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
