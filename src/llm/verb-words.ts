// Los sinónimos de los verbos (actions §9, `play-verb-words`): `content/llm/verb-words/` dice qué
// palabras usa el jugador para cada verbo del catálogo y como qué forma de la gramática se leen.
// La gramática sin red reescribe el comienzo de cada paso («me dirijo al río» → «voy al río»)
// antes de buscar el verbo, así cada verbo conserva su forma de leer el resto; el parser con LLM
// recibe la tabla como pista y la ayuda la muestra.

import type { VerbWords } from "../game/index.ts";

/** Lo que puede ir antes del verbo sin ser parte de él: «le obsequio», «lo embisto». */
const CLITIC = /^(?:le|les|lo|la|los|las)\s+/i;

/** Sin tildes ni mayúsculas, letra por letra: el largo no cambia (texto en NFC). */
function fold(s: string): string {
  return [...s]
    .map((c) => c.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().charAt(0) || c)
    .join("");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** La tabla de una lengua: qué sinónimo se lee como qué forma. */
export class VerbWordBook {
  readonly entries: readonly VerbWords[];
  readonly #as = new Map<string, string>();
  readonly #re: RegExp | null;

  constructor(entries: readonly VerbWords[]) {
    const seen = new Set<string>();
    for (const e of entries) {
      if (seen.has(e.id)) throw new RangeError(`sinónimos de verbo repetidos: ${e.id}`);
      seen.add(e.id);
      for (const g of e.synonyms) {
        for (const w of g.words) {
          const key = fold(w.normalize("NFC"));
          const before = this.#as.get(key);
          if (before !== undefined && before !== g.as) {
            throw new RangeError(`sinónimo con dos lecturas: «${w}»`);
          }
          this.#as.set(key, g.as);
        }
      }
    }
    this.entries = entries;
    // Los más largos primero: «me voy de caza» antes que «me voy».
    const words = [...this.#as.keys()].sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
    this.#re =
      words.length === 0
        ? null
        : new RegExp(
            `^(?:${words.map((w) => escapeRegExp(w).replace(/ /g, "\\s+")).join("|")})(?![\\p{L}])`,
            "u",
          );
  }

  /** El verbo de un sinónimo, o `undefined`. */
  verbOf(word: string): string | undefined {
    const key = fold(word.normalize("NFC").trim());
    return this.entries.find((e) => e.synonyms.some((g) => g.words.some((w) => fold(w) === key)))
      ?.id;
  }

  /**
   * El paso con su comienzo dicho como lo entiende la gramática: si empieza con un sinónimo
   * (con o sin «le», «lo»… delante), se lo cambia por su forma; si no, queda igual.
   */
  rewrite(text: string): string {
    if (this.#re === null) return text;
    const t = text.normalize("NFC");
    const folded = fold(t);
    const whole = this.#re.exec(folded);
    if (whole) return this.#put(t, 0, whole[0]);
    const clitic = CLITIC.exec(folded);
    if (!clitic) return text;
    const after = this.#re.exec(folded.slice(clitic[0].length));
    return after ? this.#put(t, clitic[0].length, after[0]) : text;
  }

  #put(text: string, at: number, matched: string): string {
    const as = this.#as.get(matched.replace(/\s+/g, " ")) as string;
    return `${text.slice(0, at)}${as}${text.slice(at + matched.length)}`;
  }

  /** La pista para el parser con LLM: por verbo, sus formas y sinónimos. */
  hint(): string {
    return this.entries
      .map((e) => {
        const synonyms = e.synonyms.flatMap((g) => g.words);
        return `- ${e.id}: ${[...e.forms, ...synonyms].join(", ")}`;
      })
      .join("\n");
  }
}
