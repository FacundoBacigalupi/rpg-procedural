// Las frases del oyente como contenido (dialogue §16): una lista por intención, con huecos
// (`{name}`, `{where}`, `{what}`). El oyente nunca dice algo que no esté acá: la respuesta la
// decide la sim y las palabras salen de esta lista, elegidas con el rng y la formalidad.

import { contentId, defineContent, type Random, z } from "../../core/index.ts";

export const SpeechLine = z.strictObject({
  id: contentId,
  /** Variantes informales (voseo de aldea) y, si hay, formales (a quien está por encima). */
  lines: z.array(z.string().trim().min(1)).min(1),
  formal: z.array(z.string().trim().min(1)).optional(),
});
export type SpeechLine = z.infer<typeof SpeechLine>;
export const SPEECH_LINES = defineContent("speech", SpeechLine);

export type Params = Readonly<Record<string, string>>;

/** La frase `id` con los huecos llenos; falla fuerte si falta la línea o un hueco. */
export function sayLine(
  lines: readonly SpeechLine[],
  id: string,
  params: Params,
  rng: Random,
  formal = false,
): string {
  const line = lines.find((l) => l.id === id);
  if (!line) throw new RangeError(`falta la línea de habla "${id}"`);
  const pool = formal && line.formal ? line.formal : line.lines;
  const pick = pool[rng.int(0, pool.length - 1)] as string;
  return pick.replace(/\{(\w+)\}/g, (_m, key: string) => {
    const v = params[key];
    if (v === undefined) throw new RangeError(`la línea "${id}" pide {${key}}`);
    return v;
  });
}
