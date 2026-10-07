// Ejemplos del parser (narration §10): lo que escribe el jugador, la escena como la percibe el
// personaje y el borrador que se espera. Son contenido revisado a mano en
// `content/llm/parser-examples/`. Sirven de pocos tiros en el prompt (`shot`), de casos del banco
// de pruebas de modelos y de tests: todo borrador esperado tiene que pasar el control del catálogo.

import { contentId, defineContent, z } from "../../core/index.ts";
import { IntentDraft } from "./intent.ts";

export const ParserExample = z.strictObject({
  id: contentId,
  /** Lo que escribe el jugador, tal cual. */
  text: z.string().trim().min(1),
  /** La escena percibida, con etiquetas (lo que el parser recibiría de `PlayerView`). */
  scene: z.string().trim().min(1).optional(),
  /** Las últimas intenciones, para "otra vez" o "lo mismo con él". */
  recent: z.array(z.string().trim().min(1)).max(8).optional(),
  /** Va en el prompt como ejemplo resuelto; el banco no lo puntúa. */
  shot: z.boolean().default(false),
  expect: IntentDraft,
  /** Qué prueba el caso. */
  notes: z.string().optional(),
});
export type ParserExample = z.infer<typeof ParserExample>;

export const PARSER_EXAMPLES = defineContent("llm/parser-examples", ParserExample);
