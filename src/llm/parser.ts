// El parser de intención (narration §10, actions §9): texto del jugador → `IntentDraft`, con la
// salida restringida por el JSON Schema del mismo esquema Zod que la valida. Las instrucciones van
// en inglés (los modelos chicos las siguen mejor); el jugador escribe en español.
//
// Fase 0: el contexto es texto (la escena percibida y los verbos posibles ya redactados). En la
// Fase 1 sale de `PlayerView` y del catálogo de `content/`, con ejemplos de
// `content/llm/parser-examples/`.

import { IntentDraft, intentDraftJsonSchema } from "../sim/index.ts";
import type { JobResult, LlmJobs } from "./jobs.ts";

export interface ParserInput {
  /** Lo que escribió el jugador, tal cual. */
  readonly text: string;
  /** La escena como la percibe el personaje, con etiquetas; nunca la verdad. */
  readonly scene?: string | undefined;
  /** Los verbos posibles en la escena (claves del catálogo), con una línea de qué hacen. */
  readonly verbs?: readonly { readonly id: string; readonly gloss: string }[] | undefined;
  /** Las últimas intenciones del jugador, para entender "otra vez" o "lo mismo con él". */
  readonly recent?: readonly string[] | undefined;
}

export const PARSER_SYSTEM = [
  "You translate what the player writes into a structured intent for a simulated world.",
  "The player writes in Spanish about what their character does. You only describe the attempt:",
  '- Never decide outcomes. If the player writes a result ("I convince him", "I find the herb"),',
  "  turn it into the attempt (persuade, search) and put the discarded result in `stripped`.",
  '- Never make other people act. "And he gives me the money" becomes a request or is stripped.',
  "- Refer to people, things and places by description (`text` and `features`), in the player's",
  "  words; never invent names or ids.",
  "- Use only verbs from the list when one is given; whatever fits no verb goes to `unmapped`.",
  '- Big life goals are `kind: "goal"`; questions to the game are `question_ooc`; game commands',
  "  are `meta`. Those carry `text` and no plan.",
  "- What the character says aloud goes in `speech.text`, verbatim.",
  "Answer only with the JSON object.",
].join("\n");

function userMessage(input: ParserInput): string {
  const parts: string[] = [];
  if (input.verbs && input.verbs.length > 0) {
    parts.push(`Verbs:\n${input.verbs.map((v) => `- ${v.id}: ${v.gloss}`).join("\n")}`);
  }
  if (input.scene) parts.push(`What the character perceives:\n${input.scene}`);
  if (input.recent && input.recent.length > 0) {
    parts.push(`Recent intents:\n${input.recent.map((r) => `- ${r}`).join("\n")}`);
  }
  parts.push(`Player: ${input.text}`);
  return parts.join("\n\n");
}

export function parseIntent(jobs: LlmJobs, input: ParserInput): Promise<JobResult<IntentDraft>> {
  return jobs.structured(
    "parser",
    IntentDraft,
    { name: "IntentDraft", schema: intentDraftJsonSchema() },
    {
      messages: [
        { role: "system", content: PARSER_SYSTEM },
        { role: "user", content: userMessage(input) },
      ],
      temperature: 0,
    },
  );
}
