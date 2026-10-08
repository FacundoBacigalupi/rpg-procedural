// Religión popular de la aldea (religion §1, §2, §6, Fase 1). Una religión es lo que un grupo cree
// sobre lo invisible y lo que hace por eso: las afirmaciones (doctrinas) son creencias y nunca se
// vuelven verdad por estar difundidas; `truth` de cada ser venerado dice quién está de verdad del
// otro lado (nadie, en la familia xianxia base) y solo lo lee el inspector. Todavía no hay
// identidad religiosa por persona (Fase 2) ni economía del templo (Fase 3).

import { contentId, defineContent, z } from "../../core/index.ts";

export const RELIGION_KINDS = [
  "folk",
  "sages",
  "revelation",
  "mystery",
  "state",
  "immortal_cult",
  "millenarian",
  "skeptic",
] as const;
export type ReligionKind = (typeof RELIGION_KINDS)[number];

export const DOCTRINE_TOPICS = [
  "cosmos",
  "heaven",
  "death",
  "gods",
  "morality",
  "ritual-efficacy",
  "cultivation",
  "society",
  "history",
] as const;

export const DOCTRINE_SOURCES = [
  "revelation",
  "text",
  "founder",
  "council",
  "tradition",
  "miracle",
  "inference",
] as const;

/** Una afirmación sobre el mundo invisible, comparable con la ley del mundo (§3). */
export const DoctrineDef = z.strictObject({
  id: contentId,
  claim: z.string().min(1),
  topic: z.enum(DOCTRINE_TOPICS),
  /** Cuánto de la identidad religiosa depende de creerla. */
  centrality: z.number().min(0).max(1),
  source: z.enum(DOCTRINE_SOURCES),
  /** Contra `WorldTruth`: solo para el inspector y la crónica, nunca para el personaje (§3). */
  truthStatus: z.enum(["true", "false", "partly", "unknowable"]),
  /** Por qué la verdad es esa, en una frase (qué ley del mundo la confirma o la desmiente). */
  whyTruth: z.string().min(1),
});
export type DoctrineDef = z.infer<typeof DoctrineDef>;

export const DOCTRINES = defineContent("doctrines", DoctrineDef);

export const PRACTICE_KINDS = ["offering", "festival", "taboo", "rite", "divination"] as const;
export type PracticeKind = (typeof PRACTICE_KINDS)[number];

export const PracticeDef = z.strictObject({
  id: contentId,
  name: z.string().min(1),
  kind: z.enum(PRACTICE_KINDS),
  /** Qué ser venerado la recibe (si lo hay). */
  to: contentId.optional(),
  /** Rasgo cultural que ordena la fecha o la forma (por ejemplo `festival.harvest`). */
  trait: contentId.optional(),
  /** Bienes que se ofrendan o se prohíben. */
  goods: z.array(contentId).default([]),
  /** Cada cuántos días se hace; falta si depende de un hecho (una muerte, una cosecha). */
  everyDays: z.number().positive().optional(),
  /** Qué creen que consigue: la creencia, no el efecto real (spirits §6 lo resuelve por la física). */
  believedEffect: z.string().min(1),
  /** Qué hace de verdad por la gente (consuelo, cohesión, cara), sin tocar la ley del mundo. */
  socialEffect: z.string().min(1),
});
export type PracticeDef = z.infer<typeof PracticeDef>;

/** Quién está del otro lado de verdad: nadie, o un espíritu que el mundo ya tiene (spirits §9). */
export const SacredBeingDef = z.strictObject({
  id: contentId,
  name: z.string().min(1),
  kind: z.enum(["ancestors", "place_spirit", "local_god", "cultivator", "heaven"]),
  /** Lo que la gente cree que es y que puede. */
  believed: z.string().min(1),
  truth: z.enum(["none", "spirit"]),
  /** Dónde se lo venera, en palabras del lugar (tablilla de la casa, el pozo). */
  where: z.string().min(1),
});
export type SacredBeingDef = z.infer<typeof SacredBeingDef>;

export const ReligionDef = z.strictObject({
  id: contentId,
  name: z.string().min(1),
  kind: z.enum(RELIGION_KINDS),
  /** La cultura de la que sale; la religión popular es parte de ella (culture §1). */
  culture: contentId,
  doctrines: z.array(contentId).min(1),
  sacredBeings: z.array(SacredBeingDef),
  practices: z.array(PracticeDef).min(1),
  /** Fracción de la aldea que pertenece y fracción que cree lo central. */
  adherence: z.strictObject({
    belonging: z.number().min(0).max(1),
    belief: z.number().min(0).max(1),
  }),
  /** La pertenencia múltiple es lo normal en lo popular (§1); una exclusiva lo dice. */
  exclusive: z.boolean().default(false),
  /** De dónde salió, como lo cuenta la gente. */
  because: z.string().min(1),
});
export type ReligionDef = z.infer<typeof ReligionDef>;

export const RELIGIONS = defineContent("religions", ReligionDef, (r) => [
  { kind: "cultures", id: r.culture, at: "culture" },
  ...r.doctrines.map((id, i) => ({ kind: "doctrines", id, at: `doctrines[${i}]` })),
  ...r.practices.flatMap((p, i) => [
    ...p.goods.map((id, j) => ({ kind: "goods", id, at: `practices[${i}].goods[${j}]` })),
    ...(p.trait ? [{ kind: "culture-traits", id: p.trait, at: `practices[${i}].trait` }] : []),
  ]),
]);

/** Problemas internos: ids repetidos, prácticas para un ser que no existe, ofrendas a nadie. */
export function religionProblems(religion: ReligionDef): string[] {
  const out: string[] = [];
  const beings = new Set<string>();
  for (const b of religion.sacredBeings) {
    if (beings.has(b.id)) out.push(`${religion.id}: el ser ${b.id} está dos veces`);
    beings.add(b.id);
  }
  const practices = new Set<string>();
  for (const p of religion.practices) {
    if (practices.has(p.id)) out.push(`${religion.id}: la práctica ${p.id} está dos veces`);
    practices.add(p.id);
    if (p.to !== undefined && !beings.has(p.to)) {
      out.push(`${religion.id}: ${p.id} es para ${p.to}, que no es un ser venerado`);
    }
    if (p.kind === "offering" && p.to === undefined) {
      out.push(`${religion.id}: la ofrenda ${p.id} no dice a quién`);
    }
  }
  if (new Set(religion.doctrines).size !== religion.doctrines.length) {
    out.push(`${religion.id}: hay doctrinas repetidas`);
  }
  return out;
}
