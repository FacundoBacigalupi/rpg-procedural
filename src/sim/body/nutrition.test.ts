import { describe, expect, it } from "vitest";
import {
  CLEAN_WATER,
  deficiency,
  deficiencyEffects,
  deficiencyStage,
  dietIntake,
  fullStores,
  type NutrientStores,
  netHydration,
  stepStores,
  waterDose,
  waterWarning,
} from "./nutrition.ts";

const need = { protein: 55, vitaminC: 1, iodine: 1, iron: 1, vitaminD: 1 };

function run(days: number, intake: typeof need, mult = 1): NutrientStores {
  let s = fullStores();
  for (let d = 0; d < days; d++) s = stepStores(s, intake, mult);
  return s;
}

describe("nutrientes crónicos", () => {
  it("una dieta que cubre la necesidad no cambia nada", () => {
    const s = run(365, need);
    expect(deficiencyEffects(s)).toEqual(deficiencyEffects(fullStores()));
    expect(deficiency(s, "vitaminC")).toBe(0);
  });

  it("sin fruta fresca el escorbuto llega en meses, no en días", () => {
    const diet = { ...need, vitaminC: 0 };
    expect(deficiencyStage(run(30, diet), "vitaminC")).toBe("none");
    expect(deficiencyStage(run(120, diet), "vitaminC")).toBe("severe");
    expect(deficiencyEffects(run(120, diet)).reopenWound).toBeGreaterThan(0);
  });

  it("la necesidad mayor agota la reserva más rápido y el hierro es la más lenta", () => {
    const diet = { ...need, iron: 0.5 };
    expect(run(100, diet, 1.5).iron).toBeLessThan(run(100, diet, 1).iron);
    expect(deficiency(run(100, { ...need, iron: 0 }), "iron")).toBe(0);
  });

  it("dietIntake suma kilos por perfil", () => {
    const t = dietIntake([
      { kg: 2, profile: { vitaminC: 0.25 } },
      { kg: 1, profile: { vitaminC: 0.5, protein: 20 } },
    ]);
    expect(t.vitaminC).toBeCloseTo(1);
    expect(t.protein).toBe(20);
  });
});

describe("calidad del agua", () => {
  it("hervirla quita la carga pero no la sal; la carga sola no avisa", () => {
    const bad = { ...CLEAN_WATER, load: 0.6 };
    expect(waterDose({ ...bad, treated: 1 })).toBe(0);
    expect(waterDose(bad)).toBeCloseTo(0.6);
    expect(waterWarning(bad)).toBeLessThan(waterWarning({ ...CLEAN_WATER, turbidity: 0.5 }));
    expect(netHydration(1, { ...CLEAN_WATER, salinity: 1 })).toBeLessThan(0);
  });
});
