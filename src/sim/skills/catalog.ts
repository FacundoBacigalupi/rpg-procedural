// Las habilidades como contenido (skills §1): qué facetas tiene cada una, qué aptitudes innatas y
// qué capacidades del cuerpo ponen su techo, cuán tácita es, la forma de su curva y cuánto la
// practica un chico de la aldea al crecer. Los verbos dicen qué habilidad usan y cuánto pesa cada
// faceta (`skill` en `content/actions/`); `SkillCatalog` comprueba que esas facetas existan en la
// habilidad, que es algo que el esquema de un verbo solo no puede ver.

import { contentId, defineContent, z } from "../../core/index.ts";
import { type ActionDef, CAPABILITIES } from "../actions/index.ts";

/** Las partes de un saber hacer (skills §2.1). La Fase 1 usa las tres primeras; `accent` es la voz que imita acentos ajenos (language §5). */
export const FACETS = [
  "execution",
  "reading",
  "judgment",
  "knowledge",
  "endurance",
  "composure",
  "accent",
] as const;
export type FacetKey = (typeof FACETS)[number];

/** Las facetas que dependen del cuerpo: las capacidades y la vejez bajan su techo (§4.2). */
export const BODILY_FACETS: readonly FacetKey[] = ["execution", "endurance"];

export const SKILL_DOMAINS = [
  "combat",
  "craft",
  "social",
  "body",
  "study",
  "language",
  "esoteric",
  "survival",
  "arts",
] as const;

const Unit = z.number().min(0).max(1);

export const SkillDef = z
  .strictObject({
    id: contentId,
    name: z.string().min(1),
    domain: z.enum(SKILL_DOMAINS),
    facets: z.array(z.enum(FACETS)).min(1),
    /** Las aptitudes innatas que ponen el techo y la velocidad (`usesAptitudes`), en pesos. */
    aptitudes: z.array(z.strictObject({ trait: contentId, weight: z.number().positive() })).min(1),
    /** Cuánto pesa cada capacidad en el techo de las facetas del cuerpo (`usesCapabilities`). */
    capabilities: z.partialRecord(z.enum(CAPABILITIES), z.number().positive()).default({}),
    /** Cuánto del dominio no se puede pasar como texto (forja ~0,8, contabilidad ~0,3). */
    tacitness: Unit,
    /**
     * La curva (§4.1): `rate` es el nivel por hora de práctica ideal al empezar y `k` cuánto
     * frena cerca del techo (Δ ∝ (1 − nivel/techo)^k).
     */
    curve: z.strictObject({ rate: z.number().positive(), k: z.number().min(1).default(3) }),
    /**
     * Cuánto la practica alguien criado en la aldea (la siembra de la pre-corrida): desde qué
     * edad, cuántas horas por año y la facilidad en desvíos de la tarea típica de un novato.
     */
    upbringing: z
      .strictObject({
        fromAge: z.number().min(0),
        hoursPerYear: z.number().positive(),
        ease: z.number(),
      })
      .optional(),
  })
  .superRefine((d, ctx) => {
    if (new Set(d.facets).size !== d.facets.length) {
      ctx.addIssue({ code: "custom", path: ["facets"], message: "facetas repetidas" });
    }
    const traits = d.aptitudes.map((a) => a.trait);
    if (new Set(traits).size !== traits.length) {
      ctx.addIssue({ code: "custom", path: ["aptitudes"], message: "aptitudes repetidas" });
    }
  });
export type SkillDef = z.infer<typeof SkillDef>;

export const SKILLS = defineContent("skills", SkillDef, (s) =>
  s.aptitudes.map((a, i) => ({ kind: "traits", id: a.trait, at: `aptitudes.${i}.trait` })),
);

/** Lo que un verbo pide de su habilidad: las facetas con sus pesos normalizados. */
export interface VerbSkill {
  readonly skill: SkillDef;
  readonly weights: Readonly<Partial<Record<FacetKey, number>>>;
  /** Cuántas horas de práctica vale una hora del verbo. */
  readonly intensity: number;
}

/** Las habilidades cargadas, qué usa cada verbo y qué pone en contra quien se le opone. */
export class SkillCatalog {
  readonly #skills: ReadonlyMap<string, SkillDef>;
  readonly #verbs: ReadonlyMap<string, VerbSkill>;
  readonly #opposed: ReadonlyMap<string, VerbSkill>;

  constructor(skills: readonly SkillDef[], verbs: readonly ActionDef[]) {
    this.#skills = new Map(skills.map((s) => [s.id, s]));
    const problems: string[] = [];
    const use = (
      where: string,
      spec: { id: string; facets: Record<string, number>; intensity?: number },
    ): VerbSkill | undefined => {
      const def = this.#skills.get(spec.id);
      if (!def) {
        problems.push(`${where}: la habilidad ${spec.id} no existe`);
        return undefined;
      }
      const entries = Object.entries(spec.facets);
      for (const [f] of entries) {
        if (!(def.facets as readonly string[]).includes(f)) {
          problems.push(`${where}: ${def.id} no tiene la faceta ${f}`);
        }
      }
      const total = entries.reduce((s, [, w]) => s + w, 0);
      const weights: Partial<Record<FacetKey, number>> = {};
      for (const [f, w] of entries) weights[f as FacetKey] = w / total;
      return { skill: def, weights, intensity: spec.intensity ?? 1 };
    };
    const verbsOut = new Map<string, VerbSkill>();
    const opposed = new Map<string, VerbSkill>();
    for (const v of verbs) {
      const own = v.skill && use(v.id, v.skill);
      if (own) verbsOut.set(v.id, own);
      const against = v.contest?.skill && use(`${v.id}.contest`, v.contest.skill);
      if (against) opposed.set(v.id, against);
    }
    if (problems.length > 0) throw new RangeError(problems.join("; "));
    this.#verbs = verbsOut;
    this.#opposed = opposed;
  }

  skill(id: string): SkillDef | undefined {
    return this.#skills.get(id);
  }

  get skills(): readonly SkillDef[] {
    return [...this.#skills.values()];
  }

  /** La habilidad que usa un verbo, o undefined si no usa ninguna (esperar, descansar). */
  forVerb(verb: string): VerbSkill | undefined {
    return this.#verbs.get(verb);
  }

  /** La habilidad que pone en contra el otro de la contienda del verbo, si la hay. */
  opposing(verb: string): VerbSkill | undefined {
    return this.#opposed.get(verb);
  }
}
