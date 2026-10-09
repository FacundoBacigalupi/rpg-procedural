// Memoria de narración y continuidad (narration §6). Es del lado del motor y no es la memoria del
// personaje: guarda solo texto que el jugador ya leyó. Las descripciones se guardan por clave de
// entidad (la pone quien arma el pedido) pero se entregan por etiqueta local, así que dos figuras
// que el personaje no vinculó nunca reciben las descripciones de la otra. Es JSON plano (se
// guarda con la vida) y no depende del LLM: resumir es recortar texto ya mostrado.

export const RECENT_MAX = 4;
export const SUMMARIES_MAX = 12;
export const DESCRIPTIONS_PER_ENTITY = 4;
export const MOTIFS_MAX = 8;
const SUMMARY_CHARS = 140;

export interface NarrationMemory {
  /** Cómo se nombró y describió a alguien, por clave de entidad. */
  readonly descriptions: Readonly<Record<string, readonly string[]>>;
  /** Cómo se describió un lugar, por clave de lugar. */
  readonly places: Readonly<Record<string, readonly string[]>>;
  /** Los últimos fragmentos narrados, textuales (sin marcas). */
  readonly recent: readonly string[];
  /** Lo viejo, recortado: la primera frase de cada fragmento que salió de `recent`. */
  readonly summaries: readonly string[];
  /** Imágenes recurrentes que el jugador ya vio. */
  readonly motifs: readonly string[];
}

/** Lo que el narrador recibe: etiquetas locales, nunca claves reales. */
export interface ContinuityView {
  readonly recent: readonly string[];
  readonly earlier: readonly string[];
  /** Cómo ya se nombró a cada etiqueta de este pedido. */
  readonly established: readonly { readonly id: string; readonly phrases: readonly string[] }[];
  readonly place?: readonly string[];
  readonly motifs: readonly string[];
}

export const EMPTY_MEMORY: NarrationMemory = {
  descriptions: {},
  places: {},
  recent: [],
  summaries: [],
  motifs: [],
};

const MARK = /\{\{(e\d+)\|([^}]*)\}\}/g;

function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const end = flat.search(/[.!?…](\s|$)/);
  const sentence = end >= 0 ? flat.slice(0, end + 1) : flat;
  return sentence.length > SUMMARY_CHARS ? `${sentence.slice(0, SUMMARY_CHARS - 1)}…` : sentence;
}

function pushUnique(list: readonly string[] | undefined, item: string, max: number): string[] {
  const out = [...(list ?? [])];
  if (!out.includes(item)) out.push(item);
  return out.slice(-max);
}

/** Las frases marcadas de un texto, por id local: así se nombró a cada uno. */
export function markedPhrases(marked: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const m of marked.matchAll(MARK)) {
    const id = m[1];
    const words = m[2]?.trim();
    if (id === undefined || !words) continue;
    out.set(id, pushUnique(out.get(id), words, DESCRIPTIONS_PER_ENTITY));
  }
  return out;
}

export interface RememberInput {
  /** La narración mostrada, con las marcas. */
  readonly marked: string;
  /** Texto sin marcas, lo que leyó el jugador. */
  readonly text: string;
  /** Id local → clave de entidad, de este pedido (solo las que el motor puede identificar). */
  readonly keys: ReadonlyMap<string, string>;
  readonly placeKey?: string | undefined;
  readonly motifs?: readonly string[] | undefined;
}

/** Anota lo que se acaba de mostrar. Puro: devuelve la memoria nueva. */
export function remember(memory: NarrationMemory, input: RememberInput): NarrationMemory {
  const descriptions: Record<string, readonly string[]> = { ...memory.descriptions };
  for (const [id, phrases] of markedPhrases(input.marked)) {
    const key = input.keys.get(id);
    if (key === undefined) continue;
    let merged: readonly string[] = descriptions[key] ?? [];
    for (const p of phrases) merged = pushUnique(merged, p, DESCRIPTIONS_PER_ENTITY);
    descriptions[key] = merged;
  }
  const places: Record<string, readonly string[]> = { ...memory.places };
  if (input.placeKey !== undefined && places[input.placeKey] === undefined) {
    places[input.placeKey] = [firstSentence(input.text)];
  }
  const recent = [...memory.recent, input.text];
  const summaries = [...memory.summaries];
  while (recent.length > RECENT_MAX) {
    const old = recent.shift();
    if (old !== undefined) summaries.push(firstSentence(old));
  }
  let motifs = memory.motifs;
  for (const m of input.motifs ?? []) motifs = pushUnique(motifs, m, MOTIFS_MAX);
  return {
    descriptions,
    places,
    recent,
    summaries: summaries.slice(-SUMMARIES_MAX),
    motifs,
  };
}

const IMAGE_WORDS = 3;

function contentWords(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{M}]+/gu) ?? []).filter((w) => w.length > 3);
}

/**
 * Imágenes recurrentes que el narrador inventó (narration §6): tramos de tres palabras con
 * contenido que el texto nuevo comparte con lo ya mostrado (`recent`) y que todavía no son
 * motivos. Puro y sin LLM: es comparar texto que el jugador ya leyó con el que va a leer.
 */
export function recurringImages(memory: NarrationMemory, text: string, max = 2): string[] {
  const seen = new Set<string>();
  for (const old of memory.recent) {
    const w = contentWords(old);
    for (let i = 0; i + IMAGE_WORDS <= w.length; i++) {
      seen.add(w.slice(i, i + IMAGE_WORDS).join(" "));
    }
  }
  const out: string[] = [];
  const w = contentWords(text);
  for (let i = 0; i + IMAGE_WORDS <= w.length && out.length < max; i++) {
    const gram = w.slice(i, i + IMAGE_WORDS).join(" ");
    if (seen.has(gram) && !memory.motifs.includes(gram) && !out.includes(gram)) out.push(gram);
  }
  return out;
}

/** Las oraciones de `text` que ya estaban, textuales, en lo que el jugador leyó (`recent`). */
export function repeatedSentences(recent: readonly string[], text: string): string[] {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  const old = new Set(recent.flatMap((r) => r.split(/(?<=[.!?…])\s+/u).map(norm)));
  return text
    .split(/(?<=[.!?…])\s+/u)
    .map(norm)
    .filter((s) => s.split(" ").length >= 5 && old.has(s));
}

/**
 * Una descripción nueva que no comparte ninguna palabra con cómo ya se nombró a esa figura
 * (narration §6: lo establecido se respeta). Un nombre corto («el anciano») se deja pasar:
 * solo una descripción entera distinta contradice.
 */
export function contradictsEstablished(phrases: readonly string[], words: string): boolean {
  const fresh = contentWords(words);
  if (fresh.length < 2 || phrases.length === 0) return false;
  const old = new Set(phrases.flatMap(contentWords));
  return !fresh.some((w) => old.has(w));
}

/** Lo que se entrega al narrador: por etiqueta local, solo de lo que el motor identifica. */
export function continuityFor(
  memory: NarrationMemory,
  keys: ReadonlyMap<string, string>,
  placeKey?: string,
  /** Etiquetas cuya descripción vieja no se entrega (un recuerdo deformado no cita el texto viejo). */
  forget: ReadonlySet<string> = new Set(),
): ContinuityView {
  const established: { id: string; phrases: readonly string[] }[] = [];
  for (const [id, key] of [...keys].sort(([a], [b]) => a.localeCompare(b))) {
    if (forget.has(id)) continue;
    const phrases = memory.descriptions[key];
    if (phrases !== undefined && phrases.length > 0) established.push({ id, phrases });
  }
  const place = placeKey !== undefined ? memory.places[placeKey] : undefined;
  return {
    recent: memory.recent,
    earlier: memory.summaries,
    established,
    ...(place !== undefined ? { place } : {}),
    motifs: memory.motifs,
  };
}
