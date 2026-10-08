// El validador del narrador (narration §6): lo que pasa por acá es lo único que ve el jugador. En
// orden: el formato de las marcas y sus ids; la lista blanca (nombres propios, cifras, nombres del
// mundo que el personaje no conoce); que estén todos los de `mustMention`; las prohibiciones (hablar
// del juego); el largo por modo. Los problemas van en inglés porque vuelven al modelo para que
// regenere (jobs.ts); si tampoco pasa, el narrador usa las plantillas.

import type { NarrationRequest } from "./narration.ts";
import { unknownTermsIn } from "./voice.ts";

/** Una referencia marcada: `{{e3|el viejo}}`. */
const MARK = /\{\{(e\d+)\|([^{}|]+)\}\}/g;

/** El texto que lee el jugador: cada marca queda en sus palabras. */
export function stripMarks(text: string): string {
  return text.replace(MARK, (_, _id: string, words: string) => words);
}

/** Los ids que nombra un texto marcado, en orden de aparición, sin repetir. */
export function markedIds(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(MARK)) {
    const id = m[1] as string;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** Hablarle al jugador del juego (narration §6): nunca. */
const FORBIDDEN: readonly RegExp[] = [
  /\bjugador(a|es)?\b/i,
  /\bpartida\b/i,
  /\btirada\b/i,
  /\bdados\b/i,
  /\bpuntos de vida\b/i,
  /\bHP\b/,
  /\bel juego\b/i,
  /\binventario\b/i,
  /\bstats?\b/i,
  /\bestad[íi]sticas?\b/i,
];

/** Caracteres por modo y detalle, más un margen por cada cosa que hay que contar. */
const MAX_CHARS = {
  scene: { brief: 350, normal: 900, rich: 2400 },
  action: { brief: 300, normal: 750, rich: 1800 },
  dialogue: { brief: 350, normal: 900, rich: 2000 },
  introspection: { brief: 300, normal: 700, rich: 1600 },
} as const;
const PER_ITEM = 160;
const MIN_CHARS = 5;

export interface NarrationCheck {
  /** Todos los nombres del mundo (personas, lugares): los que el personaje no conoce son fugas. */
  readonly worldNames?: readonly string[] | undefined;
}

const WORD = /[\p{L}][\p{L}\p{M}'-]*/gu;
/** Lo que abre una oración o una cita: lo que sigue puede ir en mayúscula. */
const OPENERS = new Set([".", "!", "?", "…", ":", "«", '"', "“", "¡", "¿", "—", "\n", "(", ";"]);

const CLOSERS = new Set(["»", '"', "”", ")"]);

function isCapitalized(w: string): boolean {
  const c = w[0] as string;
  return c !== c.toLowerCase() && c === c.toUpperCase();
}

/** Las palabras en mayúscula que no abren oración ni cita. */
function properWords(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(WORD)) {
    const w = m[0];
    if (!isCapitalized(w)) continue;
    let i = (m.index ?? 0) - 1;
    while (i >= 0 && text[i] === " ") i--;
    // Después de una cita que cierra, cuenta lo que la cierra por dentro: «Vamos.» Después…
    while (i > 0 && CLOSERS.has(text[i] as string)) i--;
    if (i < 0 || OPENERS.has(text[i] as string)) continue;
    out.push(w);
  }
  return out;
}

function words(s: string): string[] {
  return [...s.matchAll(WORD)].map((m) => m[0]);
}

export function validateNarration(
  text: string,
  request: NarrationRequest,
  check: NarrationCheck = {},
): string[] {
  const problems: string[] = [];
  const view = request.view;
  const labels = new Map(view.labels.map((l) => [l.localId, l]));

  // 1. Formato e ids de las marcas.
  const plain = stripMarks(text);
  if (plain.includes("{{") || plain.includes("}}")) {
    problems.push("a reference is malformed: write it exactly as {{id|words}}");
  }
  const ids = markedIds(text);
  for (const id of ids) {
    if (!labels.has(id)) problems.push(`${id} is not one of the labels`);
  }

  // 2. Lista blanca: nombres, cifras y fugas.
  // Lo que se oyó o se dijo se cita tal cual: sus palabras también valen.
  const quoted = [
    ...view.percepts.map((p) => p.words ?? ""),
    ...view.outcomes.map((o) => (o.effect.kind === "speak" ? (o.effect.text ?? "") : "")),
  ].join(" ");
  const known = new Set<string>(words(quoted));
  for (const w of view.lexicon) for (const x of words(w)) known.add(x);
  for (const l of view.labels)
    if (l.name !== undefined) for (const x of words(l.name)) known.add(x);
  for (const w of properWords(plain)) {
    if (!known.has(w)) problems.push(`"${w}" is a name the character does not know`);
  }
  for (const m of text.matchAll(MARK)) {
    const label = labels.get(m[1] as string);
    if (!label) continue;
    for (const other of view.labels) {
      if (other === label || other.name === undefined) continue;
      if (words(m[2] as string).some((w) => words(other.name as string).includes(w))) {
        problems.push(`${label.localId} is not ${other.name}`);
      }
    }
  }
  if (check.worldNames && check.worldNames.length > 0) {
    const leak = new Set(check.worldNames.flatMap(words).filter((w) => !known.has(w)));
    for (const w of new Set(words(plain))) {
      if (leak.has(w)) problems.push(`"${w}" is not something the character knows`);
    }
  }
  // El léxico del personaje (narration §4): lo técnico que no cree no sale de su boca ni de su ojo.
  if (request.vocabulary !== undefined) {
    for (const u of unknownTermsIn(plain, request.vocabulary, quoted)) {
      problems.push(`"${u.term}" is a term the character does not know: say "${u.say}" instead`);
    }
  }
  // Las cantidades que pasaron de mano (gramos, kilos, monedas) también son cifras del pedido.
  const figures = view.outcomes.flatMap((o) => {
    const e = o.effect;
    const grams =
      e.kind === "give" ? e.gave?.grams : e.kind === "trade" ? e.moved?.grams : undefined;
    const coins = e.kind === "trade" ? e.moved?.coins : undefined;
    return [grams, grams === undefined ? undefined : Number((grams / 1000).toFixed(1)), coins];
  });
  const numbers = `${quoted} ${figures.filter((n) => n !== undefined).join(" ")}`;
  for (const d of new Set(plain.match(/\d+/g) ?? [])) {
    if (!numbers.includes(d)) problems.push(`the number ${d} is not in the request`);
  }

  // 3. Cobertura.
  for (const id of request.mustMention) {
    if (!ids.includes(id)) problems.push(`${id} has to be mentioned as {{${id}|...}}`);
  }

  // 4. Prohibiciones.
  for (const re of FORBIDDEN) {
    const m = re.exec(plain);
    if (m) problems.push(`do not talk about the game ("${m[0]}")`);
  }

  // 5. Largo.
  const n = plain.trim().length;
  const items =
    view.outcomes.length + view.percepts.length + view.self.cues.length + view.thoughts.length;
  const max = MAX_CHARS[request.mode][request.style.detail] + PER_ITEM * items;
  if (n < MIN_CHARS) problems.push("the narration is empty");
  if (n > max) problems.push(`the narration is too long (${n} characters, at most ${max})`);
  return problems;
}
