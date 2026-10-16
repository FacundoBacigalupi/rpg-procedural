// Escuelas médicas por cultura (body-health §6, culture §1): qué cree y qué receta el sanador de
// la aldea sale del rasgo cultural `medicine.school` (variante dominante), no de una lista fija.
// Una escuela equivocada funciona igual de mal: la humoral nombra "sangre caliente" donde hay gripe
// y sangra al enfermo (el remedio no actúa sobre ningún patógeno y solo consuela); la empírica
// nombra las condiciones como son y receta lo que sirve. Las escuelas y los remedios son contenido
// (`content/medical-schools/`, `content/remedies/`); acá solo se arma el catálogo.

import type { Content } from "../../core/index.ts";
import {
  type CommunityCulture,
  dominantVariant,
  MEDICAL_SCHOOL_DEFS,
  REMEDIES,
  type RemedyDef,
} from "../../sim/index.ts";
import type { HealerSchool } from "./medicine.ts";

/** Id del rasgo de cultura (`content/culture-traits/health.json`) cuya variante elige la escuela. */
export const MEDICINE_SCHOOL_TRAIT = "medicine.school";

const catalogs = new WeakMap<Content, Readonly<Record<string, HealerSchool>>>();

/**
 * Las escuelas conocidas, por variante del rasgo `medicine.school`, armadas del contenido.
 * Memoizado por `content`: el mismo contenido da siempre los mismos objetos.
 */
export function medicalSchools(content: Content): Readonly<Record<string, HealerSchool>> {
  const hit = catalogs.get(content);
  if (hit) return hit;
  const remedies = new Map<string, RemedyDef>(content.all(REMEDIES).map((r) => [r.id, r]));
  const out: Record<string, HealerSchool> = {};
  for (const s of content.all(MEDICAL_SCHOOL_DEFS)) {
    out[s.id] = {
      models: s.models,
      remedies: s.remedies.map((id) => {
        const r = remedies.get(id);
        if (!r) throw new Error(`escuela ${s.id}: falta el remedio ${id}`);
        return r;
      }),
      remedyFor: s.remedyFor,
      ...(s.isolation !== undefined ? { isolation: s.isolation } : {}),
      ...(s.compliance !== undefined ? { compliance: s.compliance } : {}),
      ...(s.capacity !== undefined ? { capacity: s.capacity } : {}),
      ...(s.minSkill !== undefined ? { minSkill: s.minSkill } : {}),
    };
  }
  catalogs.set(content, out);
  return out;
}

/**
 * La escuela que sigue la cultura: la del `trait` por su variante dominante en `catalog`;
 * `undefined` si la cultura no lo tiene o la variante no tiene escuela (sin sanador por escuela).
 */
export function schoolOfCulture(
  culture: CommunityCulture | undefined,
  catalog: Readonly<Record<string, HealerSchool>>,
  trait: string = MEDICINE_SCHOOL_TRAIT,
): HealerSchool | undefined {
  const v = dominantVariant(culture, trait);
  return v === undefined ? undefined : catalog[v];
}
