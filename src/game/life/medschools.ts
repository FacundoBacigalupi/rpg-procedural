// Escuelas médicas por cultura (body-health §6, culture §1): qué cree y qué receta el sanador de
// la aldea sale del rasgo cultural `medicine.school` (variante dominante), no de una lista fija.
// Una escuela equivocada funciona igual de mal: la humoral nombra "sangre caliente" donde hay gripe
// y sangra al enfermo (el remedio no actúa sobre ningún patógeno y solo consuela); la empírica
// nombra las condiciones como son y receta lo que sirve. Puro: el catálogo es dato explícito.

import { type CommunityCulture, dominantVariant, type RemedyDef } from "../../sim/index.ts";
import type { HealerSchool } from "./medicine.ts";

/** Id del rasgo de cultura (`content/culture-traits/health.json`) cuya variante elige la escuela. */
export const MEDICINE_SCHOOL_TRAIT = "medicine.school";

const infusion: RemedyDef = {
  id: "infusion",
  targets: ["flu", "fever"],
  onsetHours: 1,
  peakHours: 6,
  endHours: 48,
  potency: 0.6,
  optimalDose: 1,
  toxicDose: 3,
  placebo: 0.2,
};

const poultice: RemedyDef = {
  id: "poultice",
  targets: ["pox"],
  onsetHours: 2,
  peakHours: 12,
  endHours: 72,
  potency: 0.3,
  optimalDose: 1,
  toxicDose: 2,
  placebo: 0.2,
};

/** Sangría: no actúa sobre ningún patógeno (solo consuela) y daña si se pasa de la dosis. */
const bloodletting: RemedyDef = {
  id: "bloodletting",
  targets: [],
  onsetHours: 0.5,
  peakHours: 2,
  endHours: 12,
  potency: 0,
  optimalDose: 0.5,
  toxicDose: 1.5,
  placebo: 0.35,
};

/** Las escuelas conocidas, por variante del rasgo `medicine.school`. */
export const MEDICAL_SCHOOLS: Readonly<Record<string, HealerSchool>> = {
  /** Mira las condiciones como son y receta lo que sirve. */
  empirical: {
    models: [
      { id: "flu", signature: { fever: 0.8, weakness: 0.6 }, prior: 0 },
      { id: "fever", signature: { fever: 1, thirst: 0.4 }, prior: 0 },
      { id: "pox", signature: { fever: 0.5, pallor: 0.6 }, prior: 0 },
    ],
    remedies: [infusion, poultice],
    remedyFor: { flu: "infusion", fever: "infusion", pox: "poultice" },
    minSkill: 0.2,
  },
  /** Hierbas sin teoría: nombra con sesgo (tiende a ver gripe), receta lo mismo. */
  herbal: {
    models: [
      { id: "flu", signature: { fever: 0.8, weakness: 0.6 }, prior: 0.3 },
      { id: "fever", signature: { fever: 1, thirst: 0.4 }, prior: 0.3 },
      { id: "pox", signature: { fever: 0.5, pallor: 0.6 }, prior: -0.3 },
    ],
    remedies: [infusion, poultice],
    remedyFor: { flu: "infusion", fever: "infusion", pox: "poultice" },
    minSkill: 0.15,
  },
  /** Humores: todo es sangre caliente o fría y se sangra; el remedio solo consuela. */
  humoral: {
    models: [
      { id: "hot_blood", signature: { fever: 1, thirst: 0.5, weakness: 0.3 }, prior: 0.2 },
      { id: "cold_blood", signature: { pallor: 0.8, weakness: 0.6 }, prior: 0 },
    ],
    remedies: [bloodletting],
    remedyFor: { hot_blood: "bloodletting", cold_blood: "bloodletting" },
    minSkill: 0.2,
  },
};

/**
 * La escuela que sigue la cultura: la del `trait` por su variante dominante en `catalog`;
 * `undefined` si la cultura no lo tiene o la variante no tiene escuela (sin sanador por escuela).
 */
export function schoolOfCulture(
  culture: CommunityCulture | undefined,
  catalog: Readonly<Record<string, HealerSchool>> = MEDICAL_SCHOOLS,
  trait: string = MEDICINE_SCHOOL_TRAIT,
): HealerSchool | undefined {
  const v = dominantVariant(culture, trait);
  return v === undefined ? undefined : catalog[v];
}
