// Las palabras de la forma de habla que alguien dijo u oyó (language §13): el honorífico y las
// palabras con rodeo o tabú entran al léxico de quien participó de la charla, y solo esas pueden
// citarse. Puro: la fila es de la persona y el narrador la lee como parte de su lista blanca.

import { table } from "../world/index.ts";

export interface HeardWords {
  readonly words: readonly string[];
}

export const HEARD_WORDS = table<HeardWords>("language.heard_words");

/** Cuántas palabras de forma guarda cada uno (las más viejas se olvidan). */
export const KEPT_HEARD_WORDS = 24;

/** Suma palabras sin repetir, las nuevas al final; se olvidan las primeras si se pasa de `KEPT_HEARD_WORDS`. */
export function learnHeardWords(
  before: HeardWords | undefined,
  said: readonly string[],
): HeardWords | undefined {
  const old = before?.words ?? [];
  const fresh = [...new Set(said.filter((w) => w.length > 0 && !old.includes(w)))];
  if (fresh.length === 0) return undefined;
  return { words: [...old, ...fresh].slice(-KEPT_HEARD_WORDS) };
}
