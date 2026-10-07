// El parser de intención (narration §10, actions §9): texto del jugador → `IntentDraft`. La salida
// va restringida por el JSON Schema estructural del catálogo (una variante por verbo con sus roles
// y modos) y se valida con el borrador más el control del catálogo, cuyos errores vuelven al
// modelo si hay que regenerar (`draft-schema.ts` en la sim). Las instrucciones van en inglés (los
// modelos chicos las siguen mejor); el jugador escribe en español.
//
// El prompt tiene un prefijo fijo (reglas, verbos del catálogo y ejemplos resueltos de
// `content/llm/parser-examples/`) que se arma una vez por catálogo con `parserSetup` y que el
// runtime puede cachear (narration §12); lo variable (escena, intenciones recientes, el texto) va
// al final. La escena todavía es texto: sale de `PlayerView` cuando llegue el narrador.

import type { z } from "../core/index.ts";
import {
  type ActionCatalog,
  type ActionDef,
  type IntentDraft,
  intentDraftFor,
  intentDraftJsonSchemaFor,
  type ParserExample,
  type PlanTemplate,
} from "../sim/index.ts";
import type { LlmMessage } from "./client.ts";
import { parseCommand } from "./grammar.ts";
import type { JobResult, LlmJobs } from "./jobs.ts";

export interface ParserInput {
  /** Lo que escribió el jugador, tal cual. */
  readonly text: string;
  /** La escena como la percibe el personaje, con etiquetas; nunca la verdad. */
  readonly scene?: string | undefined;
  /** Las últimas intenciones del jugador, para entender "otra vez" o "lo mismo con él". */
  readonly recent?: readonly string[] | undefined;
}

/** Lo que no cambia entre turnos con un mismo catálogo: el prefijo del prompt y los esquemas. */
export interface ParserSetup {
  readonly system: string;
  /** Los ejemplos resueltos, como pares pedido-respuesta. */
  readonly shots: readonly LlmMessage[];
  readonly schema: z.ZodType<IntentDraft>;
  readonly jsonSchema: { readonly name: string; readonly schema: Record<string, unknown> };
}

export const PARSER_RULES = [
  "You translate what the player writes into a structured intent for a simulated world.",
  "The player writes in Spanish about what their character does. You only describe the attempt:",
  '- Never decide outcomes. If the player writes a result ("lo convenzo", "encuentro la hierba"),',
  "  turn it into the attempt and put the discarded words in `stripped`.",
  '- Never make other people act. "y me la da" is stripped; at most the character asks for it.',
  "- Refer to people, things and places by description: `text` in the player's words and",
  "  `features` with the words that tell it apart. Never invent names or ids.",
  '- "mi padre", "mi casa": put the relation in `relation` with `to: "self"`; kinship words',
  "  (padre, madre, tío, hermano) never go in `features`.",
  '- "hasta que amanezca / salga el sol" is `until` with `is: {"kind":"light"}`; "hasta que',
  '  anochezca / oscurezca" is `{"kind":"dark"}`. Never turn them into a fixed duration.',
  "- Use only the verbs, roles, manners and templates listed below. Whatever has no verb goes to",
  "  `unmapped`; if part of it fits a verb, use the closest verb for that part.",
  "- Roles marked ? are optional: include them only when the player says them. Never fill in a",
  "  duration, a place or a thing the player did not mention.",
  "- If the character only talks, use `speech` with the exact words and `to` when said. When",
  "  talking is one step of a sequence, use the `speak` verb with `content` instead.",
  "- One action is `act`; a sequence (`seq`) or a repetition until something (`until`) is `plan`.",
  "  An `until` condition must say what it is in `is`: dark (nightfall), light (dawn), succeeded",
  "  (until it works / finds something) or elapsed (a duration).",
  '- Big life goals are `kind: "goal"`; questions to the game about the game are `question_ooc`;',
  "  game commands (save, inspector, quit) are `meta`. Those carry `text` and no plan.",
  "Answer only with the JSON object.",
].join("\n");

const ARG_HELP: Record<string, string> = {
  person: 'ref (a person: {"role","ref":{"text","kind":"person","features"}})',
  place: 'ref (a place: {"role","ref":{"text","kind":"place","features"}})',
  thing: 'ref (a thing: {"role","ref":{"text","kind":"object","features"}})',
  duration: 'duration ({"role","duration":{"amount","unit"}})',
  text: 'text ({"role","text"})',
};

function verbLine(v: ActionDef): string {
  const args =
    v.args.length === 0
      ? "no arguments"
      : v.args
          .map((a) => `${a.role}${a.required ? "" : "?"}: ${ARG_HELP[a.kind] ?? a.kind}`)
          .join("; ");
  const manners = v.manners.length > 0 ? ` Manners: ${v.manners.map((m) => m.id).join(", ")}.` : "";
  return `- ${v.id} ("${v.name}"): ${args}.${manners}`;
}

function templateLine(t: PlanTemplate): string {
  const params = t.params.map((p) => `${p.id}: ${ARG_HELP[p.kind] ?? p.kind}`).join("; ");
  return `- ${t.id} ("${t.name}"): params ${params}.`;
}

/** El mensaje variable de cada turno; los ejemplos resueltos usan el mismo formato. */
export function parserUserMessage(input: ParserInput): string {
  const parts: string[] = [];
  if (input.scene) parts.push(`What the character perceives:\n${input.scene}`);
  if (input.recent && input.recent.length > 0) {
    parts.push(`Recent intents:\n${input.recent.map((r) => `- ${r}`).join("\n")}`);
  }
  parts.push(`Player: ${input.text}`);
  return parts.join("\n\n");
}

/** Arma el prefijo fijo y los esquemas para un catálogo; los ejemplos `shot` van como pares. */
export function parserSetup(
  catalog: ActionCatalog,
  examples: readonly ParserExample[] = [],
): ParserSetup {
  const verbs = catalog.verbs.map(verbLine).join("\n");
  const templates = catalog.templates.map(templateLine).join("\n");
  const system = [
    PARSER_RULES,
    `Verbs (in \`do\` nodes: {"kind":"do","verb","args","manner"?}):\n${verbs}`,
    ...(templates
      ? [`Templates (known plans: {"kind":"template","template","params"}):\n${templates}`]
      : []),
  ].join("\n\n");
  const shots = examples
    .filter((e) => e.shot)
    .flatMap((e): LlmMessage[] => [
      { role: "user", content: parserUserMessage(e) },
      { role: "assistant", content: JSON.stringify(e.expect) },
    ]);
  return {
    system,
    shots,
    schema: intentDraftFor(catalog),
    jsonSchema: { name: "IntentDraft", schema: intentDraftJsonSchemaFor(catalog) },
  };
}

/** Los mensajes de un pedido: el prefijo fijo primero, lo de este turno al final. */
export function parserMessages(setup: ParserSetup, input: ParserInput): LlmMessage[] {
  return [
    { role: "system", content: setup.system },
    ...setup.shots,
    { role: "user", content: parserUserMessage(input) },
  ];
}

/**
 * Tope de tokens del borrador: el ejemplo más largo tiene 342 caracteres (~150 tokens). Sin tope, un modelo que con
 * la salida restringida se queda emitiendo espacios sigue hasta el timeout.
 */
export const PARSER_MAX_TOKENS = 768;

export function parseIntent(
  jobs: LlmJobs,
  setup: ParserSetup,
  input: ParserInput,
): Promise<JobResult<IntentDraft>> {
  return jobs.structured("parser", setup.schema, setup.jsonSchema, {
    messages: parserMessages(setup, input),
    temperature: 0,
    maxTokens: PARSER_MAX_TOKENS,
  });
}

export type ParsedIntent =
  | { readonly ok: true; readonly draft: IntentDraft; readonly source: "llm" | "grammar" }
  | { readonly ok: false; readonly problems: readonly string[] };

/**
 * El parser con su respaldo sin red (narration §11): si la cadena del trabajo llega a las
 * plantillas, el borrador sale de la gramática de comandos, validado con el mismo esquema. Si
 * tampoco la gramática lo entiende, el turno pide que se reformule.
 */
export async function parseIntentOrGrammar(
  jobs: LlmJobs,
  setup: ParserSetup,
  input: ParserInput,
  catalog?: ActionCatalog,
): Promise<ParsedIntent> {
  const r = await parseIntent(jobs, setup, input);
  if (r.ok) return { ok: true, draft: r.value, source: "llm" };
  const draft = parseCommand(input.text, catalog);
  const checked = draft === null ? null : setup.schema.safeParse(draft);
  if (checked?.success) return { ok: true, draft: checked.data, source: "grammar" };
  return {
    ok: false,
    problems: [
      ...r.problems,
      draft === null ? "grammar: no se entiende" : "grammar: borrador inválido",
    ],
  };
}
