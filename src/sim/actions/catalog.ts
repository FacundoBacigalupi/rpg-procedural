// El catálogo de verbos (actions §1, §2) y las plantillas de plan (§3): contenido en
// `content/actions/` y `content/plans/`, validado con Zod. Un verbo dice qué argumentos toma, qué
// modos acepta y cuánto pesan, qué hace falta para intentarlo (§5), cuánto tarda (§6), qué
// factores pesan en la tirada, cómo falla según el factor más débil (§8) y cuán evidente es su
// resultado para quien lo hace (§7, autopercepción). La tirada común está en `attempt.ts`; lo que
// cada verbo cambia en el mundo vive en su resolver, y el contenido elige cuál.

import { contentId, defineContent, z } from "../../core/index.ts";
import { PLACE_KINDS } from "../world/index.ts";

/** Lo que está en juego al hacer el verbo (player-loop «Tono de las opciones»): sale del catálogo. */
export const ACTION_STAKES = ["none", "harm", "lethal", "crime"] as const;
export type ActionStakes = (typeof ACTION_STAKES)[number];

export const ACTION_DOMAINS = [
  "movement",
  "manipulation",
  "perception",
  "social",
  "combat",
  "work",
  "body",
  "mind",
  "esoteric",
  "time",
] as const;

/** Capacidades del cuerpo que piden los verbos (body-health §3). */
export const CAPABILITIES = ["locomotion", "manipulation", "speech", "strength"] as const;
export type CapabilityKey = (typeof CAPABILITIES)[number];

/**
 * Lo que pesa en una tirada. Los tres últimos son requisitos que, si faltan al ejecutar, dan la
 * forma del fracaso sin tirar (§5).
 */
export const FACTORS = [
  "skill",
  "light",
  "terrain",
  "nerve",
  "capability",
  "position",
  "means",
] as const;
export type FactorKey = (typeof FACTORS)[number];

/** Formas de fallar que los resolvers saben aplicar (§8). */
export const FAILURE_MODES = [
  "lost", // se pierde: termina en otro hex
  "slip", // resbala o tropieza: llega, peor
  "wrong_target", // agarra lo que no era, confunde a quién
  "poor_yield", // rinde poco
  "clumsy", // lo hace mal
  "noise", // hace ruido
  "missed", // erra el golpe
  "hesitate", // le falta el nervio
  "too_weak", // el cuerpo no da
  "not_here", // lo buscado o la contraparte no está
  "no_means", // no tiene con qué (o el otro no tiene nada)
  "no_deal", // hay con qué, pero no se ponen de acuerdo en el precio
] as const;
export type FailureModeId = (typeof FAILURE_MODES)[number];

/** Resolvers registrados (§7). Cada uno es una función en `resolve.ts`. */
export const RESOLVERS = [
  "none",
  "move",
  "observe",
  "search",
  "gather",
  "work",
  "speak",
  "strike",
  "spare",
  "trade",
  "give",
  "take",
  "store",
  "drop",
  "eat",
  "consume",
  "boil",
  "filter",
  "kindle",
  "douse",
  "cook",
  "drink",
  "use",
  "tend",
  "consult",
  "forge",
  "hire",
  "ponder",
] as const;
export type ResolverKey = (typeof RESOLVERS)[number];

/** `sight`: algo que se mira, una persona o una cosa a la vista («miro la canasta»). */
export const ARG_KINDS = ["person", "place", "duration", "text", "thing", "sight"] as const;
export type ArgKind = (typeof ARG_KINDS)[number];

const Unit = z.number().min(0).max(1);

const ArgSpec = z.strictObject({
  role: contentId,
  kind: z.enum(ARG_KINDS),
  required: z.boolean(),
});

/** Un modo y lo que cambia: duración (×), facilidad (+ desvíos), sigilo (+) y emisiones (×). */
const MannerSpec = z.strictObject({
  id: contentId,
  duration: z.number().positive().default(1),
  ease: z.number().default(0),
  stealth: z.number().default(0),
  emissions: z.number().min(0).default(1),
});

const Requirement = z.union([
  z.strictObject({ kind: z.literal("capability"), cap: z.enum(CAPABILITIES), min: Unit }),
  /** Estar en el mismo hex que el argumento `near`. */
  z.strictObject({ kind: z.literal("position"), near: contentId }),
  /** Estar en un lugar de alguno de estos tipos. */
  z.strictObject({ kind: z.literal("position"), at: z.array(z.enum(PLACE_KINDS)).min(1) }),
  /** Tener algo que ofrecer (`self`) o que el argumento tenga algo encima. */
  z.strictObject({
    kind: z.literal("means"),
    holder: z.union([z.literal("self"), contentId]),
    what: z.enum(["goods", "money"]),
  }),
]);
export type Requirement = z.infer<typeof Requirement>;

/** Rasgo innato que pesa en la tirada (la aptitud cruda, aparte de lo practicado). */
const TraitWeight = z.strictObject({ trait: contentId, weight: z.number() });

const FactorSpec = z.strictObject({
  /** Cuánto pesa la luz que falta (0: nada; 1: a oscuras se pierde ~2 desvíos). */
  light: Unit.default(0),
  /** Cuánto pesa el terreno difícil (bosque, pendiente). */
  terrain: Unit.default(0),
  /** Cuánto pesa el nervio (el temperamento audaz o tímido). */
  nerve: Unit.default(0),
  /** Rasgos innatos que pesan como aptitud cruda, en desvíos por desvío. */
  skill: z.array(TraitWeight).default([]),
});

const Contest = z.strictObject({
  /** Qué pone el otro: los rasgos con los que se opone (en desvíos por desvío). */
  against: contentId,
  oppose: z.array(TraitWeight).min(1),
  /** Si la contienda es de sigilo: perderla es que el otro lo note, no que falle. */
  stealth: z.boolean().default(false),
  /** La habilidad practicada que el otro pone en contra, con sus facetas (como `skill`). */
  skill: z
    .strictObject({ id: contentId, facets: z.record(contentId, z.number().positive()) })
    .optional(),
});

const DurationModel = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("fixed"), seconds: z.number().int().positive() }),
  /** Lo dice el argumento de duración, con un tope. */
  z.strictObject({
    kind: z.literal("arg"),
    role: contentId,
    default: z.number().int().positive(),
    max: z.number().int().positive(),
  }),
  /** Caminar: la suma de cruzar cada hex del camino. */
  z.strictObject({ kind: z.literal("path"), role: contentId }),
]);

/**
 * Hablar dura lo que se dice (dialogue §2): un saludo unos segundos, una pregunta un minuto. Con un
 * acto declarado manda `acts`; con palabras sin acto, `wordSeconds` por palabra (entre `min` y la
 * duración base); sin palabras ni acto (la charla), la duración base.
 */
const SpeechDuration = z.strictObject({
  role: contentId,
  acts: z.record(z.string().min(1), z.number().int().positive()),
  wordSeconds: z.number().positive(),
  min: z.number().int().positive(),
});

export const ActionDef = z
  .strictObject({
    id: contentId,
    name: z.string().min(1),
    domain: z.enum(ACTION_DOMAINS),
    /** Qué se juega: herir, matar o delinquir tiñe la opción sugerida (no hay lista de palabras). */
    stakes: z.enum(ACTION_STAKES).default("none"),
    args: z.array(ArgSpec).max(6),
    manners: z.array(MannerSpec).default([]),
    requires: z.array(Requirement).default([]),
    occupies: z
      .partialRecord(
        z.enum(["legs", "handL", "handR", "voice", "eyes", "mind", "essence"]),
        z.enum(["full", "partial"]),
      )
      .default({}),
    duration: DurationModel,
    /** Solo `speak`: cuánto dura según el acto o las palabras (play-speak-duration). */
    speech: SpeechDuration.optional(),
    /** Cada cuánto se puede interrumpir o re-decidir (Fase 3; por ahora se guarda). */
    checkpoint: z.number().int().positive(),
    emissions: z.strictObject({ sight: Unit, sound: Unit }),
    resolver: z.enum(RESOLVERS),
    /** Facilidad base en desvíos: 0 es una moneda al aire, 1 sale casi siempre. */
    ease: z.number(),
    factors: FactorSpec.default({ light: 0, terrain: 0, nerve: 0, skill: [] }),
    /**
     * La habilidad practicada que usa (skills §11): el id en `content/skills/`, cuánto pesa cada
     * faceta (se normalizan) y cuántas horas de práctica vale una hora del verbo (un golpe enseña
     * más por segundo que una mañana de arar). Pesa en el factor `skill` y el verbo la entrena.
     */
    skill: z
      .strictObject({
        id: contentId,
        facets: z.record(contentId, z.number().positive()),
        intensity: z.number().positive().default(1),
      })
      .optional(),
    contest: Contest.optional(),
    /**
     * A qué impulsos acerca el verbo si sale bien (-1 a 1): necesidades (`hunger`, `thirst`,
     * `rest`, `safety`, `social`, `pain`) y valores (`wealth`, `family`...). Los lee la utilidad de
     * los NPC (npc-psychology §7); los ids se validan en `sim/mind`.
     */
    serves: z.record(contentId, z.number().min(-1).max(1)).default({}),
    failureModes: z.array(z.strictObject({ id: z.enum(FAILURE_MODES), factor: z.enum(FACTORS) })),
    /** Cuán evidente es un fracaso para quien lo hace (0: no se nota; 1: siempre se nota). */
    evidence: Unit,
    /**
     * Lo que saca del lugar donde se hace (extracción, economy §2b), por tipo de lugar: el bien y
     * los gramos por hora con un resultado medio. Sale del stock finito del lugar, no de la nada.
     */
    yields: z
      .array(
        z.strictObject({
          at: z.enum(PLACE_KINDS),
          good: contentId,
          perHour: z.number().int().positive(),
          /**
           * Palabras que eligen esta salida cuando el actor nombra qué junta («junto leña»). Una salida
           * con palabras solo sale si se la nombra; sin nombrarla, la primera sin palabras del lugar.
           */
          words: z.array(z.string().min(1)).min(1).optional(),
        }),
      )
      .default([]),
    /**
     * Herramientas que sirven de instrumento (`with`, use-tools): por forma de ítem (`ITEM_LOOK.shape`),
     * cuánto rinde más el trabajo (`rate` ×) y cuánto más fácil sale (`ease`, en desvíos). Con `good`,
     * solo para esa salida de `yields` (el hacha sirve para la leña, no para los hongos). `hours`
     * es cuánto uso aguanta hasta quedar gastada (use-tools-wear): lo que rinde de más se va
     * perdiendo con el desgaste y, gastada del todo, se trabaja como a mano.
     */
    instruments: z
      .array(
        z.strictObject({
          shapes: z.array(contentId).min(1),
          good: contentId.optional(),
          rate: z.number().positive(),
          ease: z.number().default(0),
          hours: z.number().positive(),
        }),
      )
      .default([]),
  })
  .superRefine((d, ctx) => {
    const roles = new Set(d.args.map((a) => a.role));
    if (roles.size !== d.args.length) ctx.addIssue({ code: "custom", message: "roles repetidos" });
    const role = (r: string, path: (string | number)[]) => {
      if (!roles.has(r)) ctx.addIssue({ code: "custom", path, message: `rol desconocido: ${r}` });
    };
    if (d.duration.kind !== "fixed") role(d.duration.role, ["duration", "role"]);
    if (d.speech) role(d.speech.role, ["speech", "role"]);
    if (d.contest) role(d.contest.against, ["contest", "against"]);
    if (d.instruments.length > 0) role("with", ["instruments"]);
    d.instruments.forEach((t, i) => {
      if (t.good !== undefined && !d.yields.some((y) => y.good === t.good)) {
        ctx.addIssue({
          code: "custom",
          path: ["instruments", i, "good"],
          message: "sin esa salida",
        });
      }
    });
    d.requires.forEach((r, i) => {
      if (r.kind === "position" && "near" in r) role(r.near, ["requires", i, "near"]);
      if (r.kind === "means" && r.holder !== "self") role(r.holder, ["requires", i, "holder"]);
    });
    const factors = d.failureModes.map((m) => m.factor);
    if (new Set(factors).size !== factors.length) {
      ctx.addIssue({ code: "custom", path: ["failureModes"], message: "un factor, una forma" });
    }
    // Todo lo que puede hacer fallar el paso tiene que tener forma (§8).
    const needs = new Set<FactorKey>(d.requires.map((r) => r.kind));
    if (d.factors.skill.length > 0 || d.skill) needs.add("skill");
    if (d.skill && Object.keys(d.skill.facets).length === 0) {
      ctx.addIssue({ code: "custom", path: ["skill", "facets"], message: "sin facetas" });
    }
    for (const k of ["light", "terrain", "nerve"] as const) if (d.factors[k] > 0) needs.add(k);
    for (const k of needs) {
      if (!factors.includes(k)) {
        ctx.addIssue({ code: "custom", path: ["failureModes"], message: `falta la forma de ${k}` });
      }
    }
    if (d.resolver === "gather" && d.yields.length === 0) {
      ctx.addIssue({ code: "custom", path: ["yields"], message: "recolectar sin qué sacar" });
    }
    const manners = d.manners.map((m) => m.id);
    if (new Set(manners).size !== manners.length) {
      ctx.addIssue({ code: "custom", path: ["manners"], message: "modos repetidos" });
    }
  });
export type ActionDef = z.infer<typeof ActionDef>;

export const ACTIONS = defineContent("actions", ActionDef, (a) => [
  ...(a.skill ? [{ kind: "skills", id: a.skill.id, at: "skill.id" }] : []),
  ...(a.contest?.skill ? [{ kind: "skills", id: a.contest.skill.id, at: "contest.skill.id" }] : []),
]);

// ---------------------------------------------------------------------------------------------
// Plantillas de plan (§3): secuencias conocidas con parámetros, saber cultural.

const TemplateArg = z.union([
  z.strictObject({ role: contentId, param: contentId }),
  z.strictObject({ role: contentId, seconds: z.number().int().positive() }),
]);

export type TemplateNode =
  | {
      readonly kind: "do";
      readonly verb: string;
      readonly args: readonly z.infer<typeof TemplateArg>[];
      readonly manner?: readonly string[] | undefined;
    }
  | { readonly kind: "seq"; readonly steps: readonly TemplateNode[] };

const TemplateNode: z.ZodType<TemplateNode> = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("do"),
    verb: contentId,
    args: z.array(TemplateArg),
    manner: z.array(contentId).optional(),
  }),
  z.strictObject({
    kind: z.literal("seq"),
    get steps() {
      return z.array(TemplateNode).min(1);
    },
  }),
]);

export const PlanTemplate = z.strictObject({
  id: contentId,
  name: z.string().min(1),
  params: z.array(z.strictObject({ id: contentId, kind: z.enum(["person", "place"]) })).min(1),
  root: TemplateNode,
});
export type PlanTemplate = z.infer<typeof PlanTemplate>;

function templateVerbs(node: TemplateNode, at: string): { verb: string; at: string }[] {
  if (node.kind === "do") return [{ verb: node.verb, at }];
  return node.steps.flatMap((s, i) => templateVerbs(s, `${at}.steps.${i}`));
}

export const PLANS = defineContent("plans", PlanTemplate, (t) =>
  templateVerbs(t.root, "root").map(({ verb, at }) => ({ kind: "actions", id: verb, at })),
);

/**
 * Una función de una cosa (actions, «Ampliación: `use`»): a qué formas de ítem o tipos de fijo se
 * aplica (`on`), con qué palabras se pide («sacar agua») y, si es otro verbo con la cosa al lado,
 * cuál (`as`: el pozo sin recipiente es `drink` ahí). Sin `as`, la resuelve `use` con su id.
 * `vessels`: las formas de ítem que la función llena y cuántos litros les caben (`draw_water`).
 */
export const AffordanceDef = z.strictObject({
  id: contentId,
  name: z.string().min(1),
  on: z.array(z.string().min(1)).min(1),
  words: z.array(z.string().min(1)),
  as: contentId.optional(),
  /** La que vale cuando no se dice cómo («uso el pozo»); si ninguna lo es, la de menor id. */
  primary: z.boolean().optional(),
  vessels: z.record(z.string().min(1), z.number().positive()).optional(),
});
export type AffordanceDef = z.infer<typeof AffordanceDef>;

export const AFFORDANCES = defineContent("affordances", AffordanceDef, (a) =>
  a.as === undefined ? [] : [{ kind: "actions", id: a.as, at: "as" }],
);

/** El catálogo cargado: verbos, plantillas y funciones de las cosas por id. */
export class ActionCatalog {
  readonly #verbs: ReadonlyMap<string, ActionDef>;
  readonly #templates: ReadonlyMap<string, PlanTemplate>;
  readonly #affordances: readonly AffordanceDef[];

  constructor(
    verbs: readonly ActionDef[],
    templates: readonly PlanTemplate[] = [],
    affordances: readonly AffordanceDef[] = [],
  ) {
    this.#verbs = new Map(verbs.map((v) => [v.id, v]));
    this.#templates = new Map(templates.map((t) => [t.id, t]));
    this.#affordances = affordances;
  }

  /** Las funciones de una cosa por su forma o tipo, en el orden en que llegan (por id). */
  affordances(shape: string): readonly AffordanceDef[] {
    return this.#affordances.filter((a) => a.on.includes(shape));
  }

  /** Una función por su id (la que quedó guardada en el `how` de un `use`). */
  affordance(id: string): AffordanceDef | undefined {
    return this.#affordances.find((a) => a.id === id);
  }

  verb(id: string): ActionDef | undefined {
    return this.#verbs.get(id);
  }

  template(id: string): PlanTemplate | undefined {
    return this.#templates.get(id);
  }

  get verbs(): readonly ActionDef[] {
    return [...this.#verbs.values()];
  }

  get templates(): readonly PlanTemplate[] {
    return [...this.#templates.values()];
  }
}
