// Narrador y verbalizador (narration §5, §7; dialogue §16), en su forma de la Fase 0: el pedido
// llega ya redactado en texto y la salida pasa por el validador vacío. En la Fase 1 el pedido es
// `NarrationRequest` sobre `PlayerView` (el único muro con la verdad), con referencias marcadas y
// lista blanca; la firma de estos trabajos cambia ahí.

import type { NarrationPrefs } from "./config.ts";
import { acceptAll, type JobResult, type LlmJobs, type TextValidator } from "./jobs.ts";

const PERSON = {
  second: "second person",
  first: "first person",
  third: "third person",
} as const;

const DETAIL = {
  brief: "Keep it short: one or two sentences.",
  normal: "Keep it to a short paragraph.",
  rich: "You may write up to three paragraphs.",
} as const;

/** Las reglas fijas del narrador: el prefijo que se cachea (narration §12). */
export function narratorSystem(prefs: NarrationPrefs, language: "es" | "en"): string {
  const lang = language === "es" ? "Rioplatense Spanish" : "English";
  return [
    "You narrate a life in a simulated fantasy world to the person who plays it.",
    `Write in ${lang}, ${PERSON[prefs.person]}, ${prefs.tense} tense${language === "es" && prefs.voseo ? ", with voseo" : ""}.`,
    "Narrate only what the request says the character perceived. Never add people, objects,",
    "places, names or numbers that are not in the request. Never decide outcomes, never",
    "foreshadow, never talk to the player as a game.",
    DETAIL[prefs.detail],
  ].join("\n");
}

export interface NarrateInput {
  /** Lo percibido, ya redactado desde la vista del jugador. */
  readonly perceived: string;
  readonly prefs: NarrationPrefs;
  readonly language: "es" | "en";
  readonly validate?: TextValidator | undefined;
}

export function narrate(jobs: LlmJobs, input: NarrateInput): Promise<JobResult<string>> {
  return jobs.text(
    "narrator",
    {
      messages: [
        { role: "system", content: narratorSystem(input.prefs, input.language) },
        { role: "user", content: input.perceived },
      ],
      temperature: 0.7,
    },
    input.validate ?? acceptAll,
  );
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
