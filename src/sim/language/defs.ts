// El contenido de language (language §1-§3, §8): una lengua es una especificación (inventario con
// pesos, sílabas, romanización, cómo se arman los compuestos y los nombres) y un espacio de
// conceptos con el que se arma el léxico. Lo que sale de acá (qué consonantes tiene esta lengua,
// cómo suena "agua") lo decide `generateLanguage` con el seed, no el archivo.

import { contentId, defineContent, z } from "../../core/index.ts";

/** A qué lugar de la aldea sirve un concepto como cabeza del nombre (`PlaceRecord.detail` o tipo). */
export const PLACE_FEATURES = [
  "river",
  "stream",
  "lake",
  "sea",
  "groundwater",
  "forest",
  "fields",
] as const;
export type PlaceFeature = (typeof PLACE_FEATURES)[number];

const weight = z.number().min(0);

export const ConceptDef = z.strictObject({
  id: contentId,
  /** El concepto en castellano: la glosa que muestra el inspector (nunca la inventa el LLM). */
  es: z.string().min(1),
  pos: z.enum(["noun", "adj", "verb"]),
  /** Con qué peso entra en los nombres que se eligen (language §8): cuánto se parece a lo que se desea. */
  name: z
    .strictObject({
      male: weight.optional(),
      female: weight.optional(),
      /** Apellidos de linaje: de un lugar, un oficio o un antepasado. */
      family: weight.optional(),
      /** Para modificar el nombre de un lugar ("río claro"). */
      place: weight.optional(),
    })
    .optional(),
  /** Si es la cabeza del nombre de un lugar con esa característica. */
  feature: z.enum(PLACE_FEATURES).optional(),
});
export type ConceptDef = z.infer<typeof ConceptDef>;
export const CONCEPTS = defineContent("language-concepts", ConceptDef);

const PhonemeDef = z.strictObject({
  id: contentId,
  /** Cómo se escribe con letras del jugador (language §2): fija, un nombre se escribe siempre igual. */
  rom: z.string().regex(/^[a-z]+$/),
  weight: z.number().positive(),
});
const range = z.strictObject({ min: z.number().int().min(1), max: z.number().int().min(1) });

export const LanguageSpec = z
  .strictObject({
    id: contentId,
    name: z.string().min(1),
    consonants: z.array(PhonemeDef.extend({ coda: z.boolean() })).min(1),
    vowels: z.array(PhonemeDef).min(1),
    consonantCount: range,
    vowelCount: range,
    /** Formas de sílaba (C)V(C): con ataque y con coda, y su peso. */
    templates: z
      .array(
        z.strictObject({ onset: z.boolean(), coda: z.boolean(), weight: z.number().positive() }),
      )
      .min(1),
    /** Pesos de raíces de 1, 2, 3… sílabas. */
    rootSyllables: z.array(z.number().min(0)).min(1),
    compound: z.strictObject({ headFirst: z.boolean() }),
    names: z.strictObject({
      order: z.enum(["family-first", "given-first"]),
      /** Cuántos nombres de pila tienen dos elementos ("Qing·shui") en vez de uno. */
      compoundGivenChance: z.number().min(0).max(1),
    }),
  })
  .superRefine((s, ctx) => {
    const ids = [...s.consonants, ...s.vowels].map((p) => p.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", path: ["consonants"], message: "fonemas repetidos" });
    }
    if (s.consonantCount.min > s.consonantCount.max || s.consonantCount.max > s.consonants.length) {
      ctx.addIssue({ code: "custom", path: ["consonantCount"], message: "rango inválido" });
    }
    if (s.vowelCount.min > s.vowelCount.max || s.vowelCount.max > s.vowels.length) {
      ctx.addIssue({ code: "custom", path: ["vowelCount"], message: "rango inválido" });
    }
    if (!s.consonants.some((c) => c.coda) && s.templates.some((t) => t.coda)) {
      ctx.addIssue({
        code: "custom",
        path: ["templates"],
        message: "hay codas y ninguna consonante final",
      });
    }
  });
export type LanguageSpec = z.infer<typeof LanguageSpec>;
export const LANGUAGES = defineContent("languages", LanguageSpec);
