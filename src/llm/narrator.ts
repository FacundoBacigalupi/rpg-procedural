// Narrador y verbalizador (narration §5-§7, §11; dialogue §16). El narrador recibe un
// `NarrationRequest` armado desde `PlayerView` (el único muro con la verdad): el prompt fijo va
// primero y se cachea, el pedido en JSON al final. La salida trae las referencias marcadas, pasa
// por el validador con lista blanca y, si el modelo no está o falla dos veces, la narración sale
// de las plantillas. El jugador lee el texto sin marcas.

import type { Rng } from "../core/index.ts";
import type { PlayerView } from "../game/index.ts";
import { acceptAll, type JobResult, type LlmJobs, type TextValidator } from "./jobs.ts";
import { type NarrationRequest, narratorSystem, narratorUserMessage } from "./narration.ts";
import { renderView, type TemplateBook } from "./templates.ts";
import { type NarrationCheck, stripMarks, validateNarration } from "./validate.ts";

export interface NarrateOptions extends NarrationCheck {
  readonly templates: TemplateBook;
  /** Elige las variantes de las plantillas: `fork("narration", tick)`. */
  readonly rng: Rng;
}

export interface Narration {
  /** Lo que lee el jugador. */
  readonly text: string;
  /** Con las referencias marcadas, para la memoria de continuidad y los tests. */
  readonly marked: string;
  readonly source: "llm" | "templates";
  /** Por qué no se usó el modelo, si no se usó. */
  readonly problems: readonly string[];
}

/** Narra un turno. Solo acepta un pedido armado sobre `PlayerView`: nunca la verdad. */
export async function narrate(
  jobs: LlmJobs,
  request: NarrationRequest & { readonly view: PlayerView },
  options: NarrateOptions,
): Promise<Narration> {
  const result = await jobs.text(
    "narrator",
    {
      messages: [
        { role: "system", content: narratorSystem(request.style) },
        { role: "user", content: narratorUserMessage(request) },
      ],
      temperature: 0.7,
    },
    (text) => validateNarration(text.trim(), request, options),
  );
  if (result.ok) {
    const marked = result.value.trim();
    return { text: stripMarks(marked), marked, source: "llm", problems: [] };
  }
  const marked = renderView(request.view, options.templates, options.rng);
  return { text: stripMarks(marked), marked, source: "templates", problems: result.problems };
}

export interface VerbalizeInput {
  /** Quién habla, como lo nombra el personaje. */
  readonly speaker: string;
  /** El acto de habla ya decidido por la sim, en palabras: qué dice, no si funciona. */
  readonly content: string;
  /** Cómo habla (cultura, estrato, ánimo), ya redactado. */
  readonly voice?: string | undefined;
  readonly language: "es" | "en";
  readonly validate?: TextValidator | undefined;
}

export function verbalize(jobs: LlmJobs, input: VerbalizeInput): Promise<JobResult<string>> {
  const lang = input.language === "es" ? "Rioplatense Spanish" : "English";
  return jobs.text(
    "verbalizer",
    {
      messages: [
        {
          role: "system",
          content: [
            `You write the exact words a character says, in ${lang}.`,
            "Say what the content says and nothing more: no new facts, names or promises.",
            "Answer only with the spoken line.",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            `Speaker: ${input.speaker}`,
            input.voice ? `Voice: ${input.voice}` : "",
            `Content: ${input.content}`,
          ]
            .filter((l) => l !== "")
            .join("\n"),
        },
      ],
      temperature: 0.7,
    },
    input.validate ?? acceptAll,
  );
}
