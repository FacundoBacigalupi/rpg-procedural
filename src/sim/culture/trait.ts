// Rasgos culturales y la cultura que los reúne (culture §1, §2, §3, Fase 1). Un rasgo es una
// pregunta con varias respuestas posibles (¿qué se hace con los muertos?: enterrar, quemar…);
// una cultura dice, rasgo por rasgo, con qué peso se da cada respuesta en la gente de su
// comunidad y de dónde salió. La sim decide con lo que la gente hace; `Culture` es el nombre
// de ese parecido. Todavía no hay rasgos por persona (Fase 2) ni cambio (Fase 3).

import { contentId, defineContent, z } from "../../core/index.ts";

export const TRAIT_DOMAINS = [
  "food",
  "dress",
  "housing",
  "kinship",
  "rites_of_passage",
  "funeral",
  "festival",
  "norms",
  "values",
  "etiquette",
  "humor",
  "aesthetics",
  "practical",
  "gender_age",
  "property",
  "cosmology",
  "calendar",
] as const;
export type TraitDomain = (typeof TRAIT_DOMAINS)[number];

/** De dónde sale una costumbre (§3). */
export const TRAIT_ORIGINS = [
  "adaptation",
  "event",
  "prestige",
  "invention",
  "drift",
  "inertia",
] as const;
export type TraitOrigin = (typeof TRAIT_ORIGINS)[number];

export const TraitVariant = z.strictObject({
  id: contentId,
  name: z.string().min(1),
});

export const TraitDef = z.strictObject({
  id: contentId,
  name: z.string().min(1),
  domain: z.enum(TRAIT_DOMAINS),
  variants: z.array(TraitVariant).min(1),
  /** Cuánto marca identidad: la ropa y la comida mucho, la forma de arar poco. */
  salience: z.number().min(0).max(1),
  /** Cuánto resiste el cambio: parentesco y ritos mucho, modas nada. */
  stickiness: z.number().min(0).max(1),
  /** Qué sistemas lo consultan (los que lo hacen hoy, y los que lo harán). */
  readBy: z.array(z.string().min(1)).min(1),
  /** Comidas que tienen que existir en el mundo para que el rasgo sea posible. */
  requiresFoods: z.array(contentId).default([]),
});
export type TraitDef = z.infer<typeof TraitDef>;

export const CULTURE_TRAITS = defineContent("culture-traits", TraitDef, (t) =>
  t.requiresFoods.map((id, i) => ({ kind: "foods", id, at: `requiresFoods[${i}]` })),
);

export const CultureTrait = z.strictObject({
  trait: contentId,
  /** Peso de cada variante en la gente de la comunidad; se normaliza al sembrar. */
  variants: z.record(contentId, z.number().positive()),
  /** Números que lee quien consulta el rasgo (días de luto, sesgo de un valor). */
  params: z.record(z.string().min(1), z.number()).default({}),
  origin: z.enum(TRAIT_ORIGINS),
  /** La razón, en una frase: a la gente se la cuenta como la recuerda, no como pasó. */
  because: z.string().min(1),
});
export type CultureTrait = z.infer<typeof CultureTrait>;

export const CultureDef = z.strictObject({
  id: contentId,
  name: z.string().min(1),
  traits: z.array(CultureTrait).min(1),
});
export type CultureDef = z.infer<typeof CultureDef>;

export const CULTURES = defineContent("cultures", CultureDef, (c) =>
  c.traits.map((t, i) => ({ kind: "culture-traits", id: t.trait, at: `traits[${i}].trait` })),
);

/** Problemas de una cultura contra los rasgos que declara: variantes que no existen, rasgos repetidos. */
export function cultureProblems(culture: CultureDef, traits: readonly TraitDef[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of culture.traits) {
    if (seen.has(t.trait)) out.push(`${culture.id}: el rasgo ${t.trait} está dos veces`);
    seen.add(t.trait);
    const def = traits.find((d) => d.id === t.trait);
    if (!def) {
      out.push(`${culture.id}: no existe el rasgo ${t.trait}`);
      continue;
    }
    for (const v of Object.keys(t.variants)) {
      if (!def.variants.some((x) => x.id === v)) {
        out.push(`${culture.id}: ${t.trait} no tiene la variante ${v}`);
      }
    }
  }
  return out;
}
