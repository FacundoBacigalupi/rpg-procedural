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

/** Levenshtein: cuántas letras hay que cambiar, sacar o poner para ir de `a` a `b`. */
function editDistance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      next.push(
        Math.min(
          (row[j] as number) + 1,
          (next[j - 1] as number) + 1,
          (row[j - 1] as number) + cost,
        ),
      );
    }
    row = next;
  }
  return row[b.length] as number;
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
    // Una palabra de dos verbos la lee el que la declara en `shared`.
    const wins = new Set<string>();
    for (const e of entries) {
      if (seen.has(e.id)) throw new RangeError(`sinónimos de verbo repetidos: ${e.id}`);
      seen.add(e.id);
      const shared = new Set((e.shared ?? []).map((w) => fold(w.normalize("NFC"))));
      for (const g of e.synonyms) {
        for (const w of g.words) {
          const key = fold(w.normalize("NFC"));
          const before = this.#as.get(key);
          if (before !== undefined && before !== g.as) {
            if (wins.has(key)) continue;
            if (!shared.has(key)) throw new RangeError(`sinónimo con dos lecturas: «${w}»`);
          }
          if (shared.has(key)) wins.add(key);
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

  /** Los sinónimos de un verbo, en el orden de la tabla. */
  synonymsOf(verb: string): string[] {
    return this.entries.find((e) => e.id === verb)?.synonyms.flatMap((g) => g.words) ?? [];
  }

  /**
   * «!verbos» (`play-help-verbs`): un renglón por verbo con su nombre, una frase de ejemplo y
   * los primeros `shown` sinónimos. `name` da el nombre del catálogo («moverse»).
   */
  help(name: (verb: string) => string | undefined, shown = 4): string {
    const lines = this.entries.map((e) => {
      const some = this.synonymsOf(e.id).slice(0, shown);
      const also = some.length > 0 ? ` (también: ${some.join(", ")}…)` : "";
      return `  ${name(e.id) ?? e.id}: «${e.example}»${also}`;
    });
    return [
      "Lo que tu personaje sabe hacer, con un ejemplo de cada cosa:",
      ...lines,
      "«!verbos X» muestra todas las palabras de uno (X: el verbo o cualquiera de sus palabras).",
    ].join("\n");
  }

  /**
   * «!verbos X»: todas las formas y sinónimos del verbo que nombra X (su id, su nombre o
   * cualquiera de sus palabras), con la forma como la que se lee cada grupo; `undefined` si X no
   * es ninguno.
   */
  helpOf(query: string, name: (verb: string) => string | undefined): string | undefined {
    const key = fold(query.normalize("NFC").trim());
    const is = (w: string) => fold(w.normalize("NFC")) === key;
    const e =
      this.entries.find((x) => is(x.id) || is(name(x.id) ?? "")) ??
      this.entries.find((x) => x.forms.some(is)) ??
      this.entries.find((x) => x.synonyms.some((g) => g.words.some(is)));
    if (!e) return undefined;
    return [
      `${name(e.id) ?? e.id}: «${e.example}»`,
      `  Formas: ${e.forms.join(", ")}`,
      ...e.synonyms.map((g) => `  Como «${g.as}»: ${g.words.join(", ")}`),
    ].join("\n");
  }

  /**
   * Cuando no se entendió (`play-hint-verbs`): la forma o el sinónimo más parecido al comienzo de
   * `text` («mieo alrededor» → «miro»), por distancia de edición sin tildes, o `undefined` si nada
   * se le parece lo bastante (hasta 1 letra en palabras cortas, 2 desde cinco letras).
   */
  closest(text: string): string | undefined {
    const said = fold(text.normalize("NFC").trim()).split(/\s+/u);
    let best: { word: string; d: number } | undefined;
    for (const e of this.entries) {
      for (const w of [...e.forms, ...e.synonyms.flatMap((g) => g.words)]) {
        const target = fold(w.normalize("NFC"));
        const n = target.split(" ").length;
        const head = said.slice(0, n).join(" ");
        if (head === target) return undefined;
        const d = editDistance(head, target);
        const limit = target.length >= 5 ? 2 : 1;
        if (d <= limit && (best === undefined || d < best.d)) best = { word: w, d };
      }
    }
    return best?.word;
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

/** Lo mínimo que tiene que traer cada verbo del catálogo (`play-verb-words-guard`). */
export const MIN_VERB_SYNONYMS = 4;

/**
 * Lo que rompe la tabla al crecer (actions §9, `play-verb-words-guard`): un verbo del catálogo
 * sin entrada o con menos de `MIN_VERB_SYNONYMS` sinónimos, una entrada que no es un verbo, una
 * palabra que dice dos verbos (salvo que uno la declare en `shared`) y un sinónimo que es la
 * forma o el id de otro verbo. Cada problema nombra el par; sin problemas, vacío.
 */
export function verbWordProblems(
  entries: readonly VerbWords[],
  verbs: readonly string[],
): string[] {
  const out: string[] = [];
  for (const v of verbs) {
    const e = entries.find((x) => x.id === v);
    const n = e?.synonyms.reduce((s, g) => s + g.words.length, 0) ?? 0;
    if (!e) out.push(`el verbo ${v} no tiene palabras en verb-words`);
    else if (n < MIN_VERB_SYNONYMS) {
      out.push(`el verbo ${v} tiene ${n} sinónimos (mínimo ${MIN_VERB_SYNONYMS})`);
    }
  }
  for (const e of entries) {
    if (!verbs.includes(e.id)) out.push(`verb-words ${e.id} no es un verbo del catálogo`);
  }
  // Cada palabra con los verbos que la dicen y cómo (sinónimo, forma, id).
  const said = new Map<string, { verb: string; as: "sinónimo" | "forma" | "id" }[]>();
  const put = (word: string, verb: string, as: "sinónimo" | "forma" | "id") => {
    const key = fold(word.normalize("NFC").trim());
    const list = said.get(key) ?? [];
    if (!list.some((x) => x.verb === verb && x.as === as)) list.push({ verb, as });
    said.set(key, list);
  };
  for (const e of entries) {
    put(e.id, e.id, "id");
    for (const f of e.forms) put(f, e.id, "forma");
    for (const g of e.synonyms) for (const w of g.words) put(w, e.id, "sinónimo");
  }
  const sharedBy = (verb: string, key: string) =>
    entries.find((e) => e.id === verb)?.shared?.some((w) => fold(w.normalize("NFC")) === key) ??
    false;
  for (const [key, list] of [...said].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const synonyms = list.filter((x) => x.as === "sinónimo");
    for (const s of synonyms) {
      for (const o of list) {
        if (o.verb === s.verb || (o.as === "sinónimo" && o.verb < s.verb)) continue;
        if (sharedBy(s.verb, key) || sharedBy(o.verb, key)) continue;
        out.push(`«${key}» es sinónimo de ${s.verb} y ${o.as} de ${o.verb}`);
      }
    }
  }
  return out;
}
