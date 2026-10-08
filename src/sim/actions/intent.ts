// El borrador de intención (actions §9): lo que el parser (LLM o gramática sin red) saca del texto
// del jugador, antes de que la simulación resuelva referencias y factibilidad. Un solo esquema
// Zod con tres usos (ARCHITECTURE §7.6): el tipo, la validación de la salida del parser y, por
// `z.toJSONSchema`, la restricción de salida que se le manda al modelo.
//
// Nada de esto tiene ids reales: las referencias son descripciones (actions §4) y los verbos,
// modos y riesgos son claves del catálogo de `content/` (que llega en la Fase 1; hasta entonces
// se valida solo la forma de la clave). Las condiciones van en texto: la sim las normaliza a
// `Condition` sobre creencias.

import { contentId, z } from "../../core/index.ts";

export const EntityKind = z.enum(["person", "object", "place", "lot", "group"]);
export type EntityKind = z.infer<typeof EntityKind>;

/** "tres", "todo", "un poco". */
export const QuantitySpec = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("count"), n: z.number().int().min(1) }),
  z.strictObject({ kind: z.literal("all") }),
  z.strictObject({ kind: z.literal("some") }),
]);
export type QuantitySpec = z.infer<typeof QuantitySpec>;

/** A qué se refiere el jugador, en sus palabras: la sim lo resuelve contra lo que el personaje cree. */
export interface RefDescription {
  readonly text: string;
  readonly kind?: EntityKind | undefined;
  /** Rasgos que nombra: "viejo", "puesto de té", "empuñadura roja". */
  readonly features: readonly string[];
  /** "mi espada", "el hermano de Wu". */
  readonly relation?: { readonly to: "self" | RefDescription; readonly rel: string } | undefined;
  readonly quantity?: QuantitySpec | undefined;
}

/** Un texto del borrador: lo que dijo el jugador, recortado. */
export const DraftText = z.string().trim().min(1).max(500);
const text = DraftText;

/** El objeto con su forma, para derivar variantes (la de la salida restringida pide `kind`). */
export const RefDescriptionShape = z.strictObject({
  text,
  kind: EntityKind.optional(),
  features: z.array(text).max(16),
  get relation() {
    return z
      .strictObject({ to: z.union([z.literal("self"), RefDescription]), rel: text })
      .optional();
  },
  quantity: QuantitySpec.optional(),
});
export const RefDescription: z.ZodType<RefDescription> = RefDescriptionShape;

export const DraftDuration = z.strictObject({
  amount: z.number().positive(),
  unit: z.enum(["second", "minute", "hour", "day", "week", "month", "year"]),
});
export type DraftDuration = z.infer<typeof DraftDuration>;

/**
 * Un argumento de un verbo: su papel ("target", "tool", "to") y a qué se refiere, cuánto dura
 * ("dos horas", para los verbos con argumento de duración) o un texto libre ("hierbas").
 */
export const DraftArg = z.union([
  z.strictObject({ role: contentId, ref: RefDescription }),
  z.strictObject({ role: contentId, duration: DraftDuration }),
  z.strictObject({ role: contentId, text }),
]);
export type DraftArg = z.infer<typeof DraftArg>;

/**
 * Una condición en palabras del jugador ("si nadie mira", "hasta que anochezca"). Si el parser
 * la reconoce, la manda también normalizada en `is`; la sim solo usa `is` (no adivina el texto).
 */
export const DraftCondition = z.strictObject({
  kind: z.enum(["belief", "percept", "time", "self"]),
  text,
  is: z
    .discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("dark") }),
      z.strictObject({ kind: z.literal("light") }),
      /** "hasta encontrar algo", "hasta que me salga". */
      z.strictObject({ kind: z.literal("succeeded") }),
      z.strictObject({ kind: z.literal("elapsed"), duration: DraftDuration }),
    ])
    .optional(),
});
export type DraftCondition = z.infer<typeof DraftCondition>;

/** Como `PlanNode` (actions §3), con descripciones en vez de referencias. */
export type DraftPlanNode =
  | {
      readonly kind: "do";
      readonly verb: string;
      readonly args: readonly DraftArg[];
      readonly manner?: readonly string[] | undefined;
    }
  | { readonly kind: "seq"; readonly steps: readonly DraftPlanNode[] }
  | { readonly kind: "until"; readonly body: DraftPlanNode; readonly cond: DraftCondition }
  | {
      readonly kind: "repeat";
      readonly body: DraftPlanNode;
      readonly times?: number | undefined;
      readonly every?: DraftDuration | undefined;
    }
  | {
      readonly kind: "if";
      readonly cond: DraftCondition;
      readonly then: DraftPlanNode;
      readonly else?: DraftPlanNode | undefined;
    }
  | { readonly kind: "onEvent"; readonly trigger: DraftCondition; readonly react: DraftPlanNode }
  | {
      readonly kind: "template";
      readonly template: string;
      readonly params: Readonly<Record<string, DraftArg>>;
    };

export const DraftPlanNode: z.ZodType<DraftPlanNode> = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("do"),
    verb: contentId,
    args: z.array(DraftArg).max(8),
    manner: z.array(contentId).max(8).optional(),
  }),
  z.strictObject({
    kind: z.literal("seq"),
    get steps() {
      return z.array(DraftPlanNode).min(1).max(16);
    },
  }),
  z.strictObject({
    kind: z.literal("until"),
    get body() {
      return DraftPlanNode;
    },
    cond: DraftCondition,
  }),
  z.strictObject({
    kind: z.literal("repeat"),
    get body() {
      return DraftPlanNode;
    },
    times: z.number().int().min(1).max(1000).optional(),
    every: DraftDuration.optional(),
  }),
  z.strictObject({
    kind: z.literal("if"),
    cond: DraftCondition,
    // biome-ignore lint/suspicious/noThenProperty: el nodo `if` de actions §3; nunca se espera con await
    get then() {
      return DraftPlanNode;
    },
    get else() {
      return DraftPlanNode.optional();
    },
  }),
  z.strictObject({
    kind: z.literal("onEvent"),
    trigger: DraftCondition,
    get react() {
      return DraftPlanNode;
    },
  }),
  z.strictObject({
    kind: z.literal("template"),
    template: contentId,
    params: z.record(contentId, DraftArg),
  }),
]);

/**
 * Lo que el jugador quiere lograr al hablar, como acto de habla declarado (dialogue §2, actions §4):
 * saludar, preguntar por alguien, pedir algo, contar que alguien murió o sigue vivo, prometer.
 * Es la intención del que habla, no lo que el oyente va a entender: ese entiende las palabras.
 */
export const DraftAct = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("greet") }),
  z.strictObject({ kind: z.literal("farewell") }),
  z.strictObject({ kind: z.literal("ask"), about: RefDescription.optional() }),
  z.strictObject({ kind: z.literal("request"), what: text.optional() }),
  z.strictObject({
    kind: z.literal("tell"),
    about: RefDescription,
    claim: z.enum(["dead", "alive"]),
  }),
  z.strictObject({ kind: z.literal("promise"), what: text.optional() }),
]);
export type DraftAct = z.infer<typeof DraftAct>;

/** Lo que dice el personaje, textual (dialogue §14): la sim arma el acto de habla. */
export const SpeechDraft = z.strictObject({
  text: z.string().trim().min(1).max(2000),
  to: RefDescription.optional(),
  /** El acto que declara (opcional: sin él, el oyente entiende solo las palabras). */
  act: DraftAct.optional(),
  manner: z.array(contentId).max(8).optional(),
});
export type SpeechDraft = z.infer<typeof SpeechDraft>;

export const IntentDraft = z
  .strictObject({
    kind: z.enum(["act", "plan", "goal", "question_ooc", "meta"]),
    plan: DraftPlanNode.optional(),
    manner: z.array(contentId).max(8).optional(),
    /** "sin matar a nadie", "antes de que anochezca": la sim las normaliza a `Constraint`. */
    constraints: z.array(text).max(8).optional(),
    risksAccepted: z.array(contentId).max(8).optional(),
    /** Lo que el jugador escribió como resultado deseado y se descartó ("y lo convenzo"). */
    stripped: z.array(text).max(8).optional(),
    /** Partes que no encajan en ningún verbo. */
    unmapped: z.array(text).max(8).optional(),
    speech: SpeechDraft.optional(),
    /** Para `goal`, `question_ooc` y `meta`: el pedido en palabras del jugador. */
    text: text.optional(),
  })
  .superRefine((d, ctx) => {
    const acts = d.kind === "act" || d.kind === "plan";
    if (acts && d.plan === undefined && d.speech === undefined) {
      ctx.addIssue({ code: "custom", path: ["plan"], message: `${d.kind} necesita plan o habla` });
    }
    if (!acts && d.plan !== undefined) {
      ctx.addIssue({ code: "custom", path: ["plan"], message: `${d.kind} no lleva plan` });
    }
    if (!acts && d.text === undefined) {
      ctx.addIssue({ code: "custom", path: ["text"], message: `${d.kind} necesita text` });
    }
  });
export type IntentDraft = z.infer<typeof IntentDraft>;

/** El JSON Schema del borrador, para restringir la salida del modelo (Ollama, llama.cpp, LM Studio). */
export function intentDraftJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(IntentDraft, { io: "input", unrepresentable: "any" }) as Record<
    string,
    unknown
  >;
}
