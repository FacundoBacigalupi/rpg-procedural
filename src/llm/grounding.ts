// Fidelidad de las acciones percibidas (narration §6, `narr-action-grounding`): el validador
// estructural (validate.ts) mira marcas, nombres y cifras, pero deja pasar que el modelo cambie lo
// que vio hacer a otro («busca» por «recoge»), le sume pasos («se acerca») o le lea el adentro
// («tiembla, inquieto») sin que nada de eso esté en el pedido. Esta es la aprobación semántica,
// aparte y por léxico (`content/llm/action-words/`): sin red, determinista y conservadora.
//
// Cómo lee: parte el texto marcado en oraciones (sin lo citado); cada oración con marcas abre el
// tramo de esas etiquetas, que sigue en las oraciones sin marcas («Ves a {{e1|un chico}}. Junta
// algo»). En el tramo de una etiqueta (1) tiene que decirse cada acción que se le vio, y (2) no
// puede aparecer una palabra que diga otra acción ni un estado interior, salvo que la diga
// también una acción permitida en esa oración (lo visto de las etiquetas de la oración y los pasos
// propios). Las formas del voseo (mirás, juntaste) son del personaje y no cuentan. Las etiquetas
// que la vista nombra fuera de los percepts (deudas, agravios, pensamientos, a quién se le habló)
// no se juzgan: ahí el texto puede decir con razón lo que hicieron otro día.
//
// Las formas del voseo sí se miran para el personaje (`play-llm-invented-acts`, narration §8): una
// que diga una acción del catálogo que no está entre sus pasos («te acercás» si solo miró) es un
// acto inventado. Mirar, pensar y esperar no cuentan: son lo que hace cualquier escena.

import type { ActionWords, PlayerView } from "../game/index.ts";
import type { NarrationRequest } from "./narration.ts";
import { markedIds, stripMarks } from "./validate.ts";

const WORD = /[\p{L}][\p{L}\p{M}'-]*/gu;
/** Segunda persona del voseo y del pretérito: lo hace el personaje, no el otro. */
const SECOND_PERSON = /(?:ás|és|ís|aste|iste|abas|ías)$/u;
/** Lo citado se dijo tal cual: no es narración de lo que alguien hace. */
const QUOTED = /«[^»]*»|"[^"]*"|“[^”]*”/gu;
/** Una oración que abre con un sujeto nuevo (artículo, posesivo, «hay»…): habla de otra cosa. */
/** El presente del voseo: lo que hace ahora (el pasado puede ser un recuerdo de otro día). */
const SECOND_PERSON_NOW = /(?:ás|és|ís)$/u;
/** Lo que el personaje hace en cualquier escena sin que sea un paso: percibir, pensar, quedarse. */
const ALWAYS_OWN = new Set(["look", "ponder", "wait"]);
/** Lo que un paso trae consigo: hablarle a alguien es dirigirse a él, juntar es buscar primero. */
const IMPLIES: Readonly<Record<string, readonly string[]>> = {
  speak: ["move"],
  consult: ["move", "speak"],
  trade: ["move", "speak"],
  hire: ["speak"],
  give: ["move"],
  take: ["move"],
  search: ["move"],
  gather: ["search", "move"],
  hunt: ["search", "move"],
  eat: ["search"],
  drink: ["search"],
  tend: ["move"],
};
/** Lo negado no pasó: «no llegás a entender» no es moverse. */
const NEGATION = /(?:^|\s)(?:no|ni|nunca|jamás)\s+(?:\p{L}+\s+)?$/iu;
const OWN_SUBJECT =
  /^[¡¿—(]*(?:el|los|las|un|una|unos|unas|su|sus|tu|tus|mi|mis|este|esta|ese|esa|aquel|aquella|hay|algo|alguien|nadie|nada|todo|afuera|adentro|arriba|abajo)(?![\p{L}])/iu;

function bare(word: string): string {
  return word.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** El léxico de acciones de una lengua: qué palabras dicen qué verbo. */
export class ActionWordBook {
  readonly #entries: readonly ActionWords[];

  constructor(entries: readonly ActionWords[]) {
    const seen = new Set<string>();
    for (const e of entries) {
      if (seen.has(e.id)) throw new RangeError(`palabras de acción repetidas: ${e.id}`);
      seen.add(e.id);
    }
    this.#entries = entries;
  }

  has(verb: string): boolean {
    return this.#entries.some((e) => e.id === verb && e.kind === "action");
  }

  /** Las familias que dice una palabra: `strong` la delatan, `weak` solo cuentan como dicho. */
  familiesOf(word: string): { readonly strong: string[]; readonly weak: string[] } {
    const raw = word.toLowerCase();
    const b = bare(word);
    const strong: string[] = [];
    const weak: string[] = [];
    for (const e of this.#entries) {
      if (e.forms.includes(raw) || e.stems.some((s) => b.startsWith(s))) strong.push(e.id);
      else if (e.weak.some((s) => b.startsWith(s))) weak.push(e.id);
    }
    return { strong, weak };
  }

  kindOf(id: string): ActionWords["kind"] | undefined {
    return this.#entries.find((e) => e.id === id)?.kind;
  }
}

/** Los ids de etiqueta que la vista nombra fuera de los percepts (y de la lista de etiquetas). */
function labelsElsewhere(view: PlayerView): Set<string> {
  const ids = new Set(view.labels.map((l) => l.localId));
  const out = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === "string") {
      if (ids.has(v)) out.add(v);
    } else if (Array.isArray(v)) {
      for (const x of v) walk(x);
    } else if (v !== null && typeof v === "object") {
      for (const x of Object.values(v)) walk(x);
    }
  };
  for (const [key, value] of Object.entries(view)) {
    if (key !== "percepts" && key !== "labels") walk(value);
  }
  return out;
}

/** Lo que se le vio hacer a cada etiqueta de los percepts. */
interface Seen {
  /** Las acciones que se pueden decir de ella. */
  readonly allowed: Set<string>;
  /** Las que hay que decir (las que la plantilla diría). */
  readonly expected: Set<string>;
}

/**
 * Los problemas de fidelidad de una narración marcada con las acciones percibidas: vacío si lo que
 * dice de los demás es lo que el personaje vio. En inglés, como los del validador, porque vuelven
 * al modelo cuando regenera.
 */
export function groundingProblems(
  text: string,
  request: NarrationRequest,
  book: ActionWordBook,
): string[] {
  const view = request.view;
  const seen = new Map<string, Seen>();
  for (const p of view.percepts) {
    const s = seen.get(p.who) ?? { allowed: new Set<string>(), expected: new Set<string>() };
    seen.set(p.who, s);
    if (p.action !== undefined) {
      s.allowed.add(p.action);
      if (p.words === undefined && book.has(p.action)) s.expected.add(p.action);
    }
    if (p.words !== undefined) s.allowed.add("speak");
    if (p.detail === "vague" || p.arrived) s.allowed.add("move");
  }
  const elsewhere = labelsElsewhere(view);
  const own = new Set<string>();
  for (const o of view.outcomes) {
    own.add(o.verb);
    own.add(o.effect.kind);
    if (o.effect.kind === "observe") own.add("look");
  }
  for (const d of view.stretch?.did ?? []) own.add(d.verb);
  if ((view.stretch?.spoke ?? 0) > 0) own.add("speak");
  for (const verb of [...own]) for (const v of IMPLIES[verb] ?? []) own.add(v);

  const problems = new Set<string>();
  const said = new Set<string>();
  const marked = new Set<string>();
  let current: string[] = [];
  const sentences = text
    .replace(QUOTED, " ")
    .split(/(?<=[.!?…])\s+|\n+/u)
    .filter((s) => s.trim() !== "");
  for (const sentence of sentences) {
    // (0) Lo que hizo el personaje: solo sus pasos.
    const bareSentence = stripMarks(sentence);
    for (const m of bareSentence.matchAll(WORD)) {
      const word = m[0];
      if (!SECOND_PERSON_NOW.test(word.toLowerCase())) continue;
      if (NEGATION.test(bareSentence.slice(0, m.index))) continue;
      const acts = book
        .familiesOf(word)
        .strong.filter((a) => !a.includes(".") && book.kindOf(a) === "action");
      if (acts.length === 0 || acts.some((a) => own.has(a) || ALWAYS_OWN.has(a))) continue;
      problems.add(
        `the character did not ${acts.join(" or ")} ("${word}"): tell only what the character did`,
      );
    }
    const ids = markedIds(sentence);
    if (ids.length > 0) current = ids;
    if (current.length === 0) continue;
    for (const id of ids) marked.add(id);
    const words = [...stripMarks(sentence).matchAll(WORD)]
      .map((m) => m[0])
      .filter((w) => !SECOND_PERSON.test(w.toLowerCase()));
    const families = words.map((w) => ({ word: w, ...book.familiesOf(w) }));

    // (1) Lo que se le vio hacer, dicho en su tramo.
    for (const id of current) {
      for (const verb of seen.get(id)?.expected ?? []) {
        if (families.some((f) => f.strong.includes(verb) || f.weak.includes(verb))) {
          said.add(`${id} ${verb}`);
        }
      }
    }

    // (2) Nada que no se haya visto, si todas las etiquetas de la oración son solo percepts. Una
    // oración sin marcas que abre con su propio sujeto («El viento mueve las hojas») ya no habla
    // de la etiqueta: solo cuenta para (1).
    if (current.some((id) => !seen.has(id) || elsewhere.has(id))) continue;
    if (ids.length === 0 && OWN_SUBJECT.test(stripMarks(sentence).trim())) continue;
    const theirs = new Set<string>();
    for (const id of current) for (const a of seen.get(id)?.allowed ?? []) theirs.add(a);
    const allowed = new Set([...own, ...theirs]);
    const who = current.join(", ");
    const seenAs = [...theirs].join(", ");
    for (const f of families) {
      // Una palabra que también dice (aunque sea débil) algo permitido no delata nada.
      if (f.strong.length === 0 || [...f.strong, ...f.weak].some((a) => allowed.has(a))) continue;
      if (f.strong.some((a) => book.kindOf(a) === "state")) {
        problems.add(
          `nothing in the request says how ${who} feels or what goes on inside them ("${f.word}"): do not add it`,
        );
      } else {
        problems.add(
          `${who} was only seen to ${seenAs === "" ? "be there" : seenAs}: do not say "${f.word}" (${f.strong.join(", ")})`,
        );
      }
    }
  }

  for (const [id, s] of seen) {
    if (!marked.has(id)) continue;
    for (const verb of s.expected) {
      if (!said.has(`${id} ${verb}`)) {
        problems.add(`${id} was seen to ${verb}: say that, with words for ${verb}`);
      }
    }
  }
  return [...problems];
}
