// El hilo de la conversación (dialogue §1 `TopicStack`): de qué se viene hablando, para que «él»,
// «eso», «lo de recién» se resuelvan contra lo que cada lado tiene presente. Cada participante
// lleva su pila (puede haber entendido otra cosa: malentendido con causa), y la pila olvida: lo
// nombrado hace rato sale. Una pregunta sin contestar queda abierta hasta que se contesta o se
// cambia de tema. Todo puro e inmutable; las referencias son ids, nunca texto.

import type { AgentId } from "../../core/index.ts";

export type TopicRef =
  | { readonly kind: "person"; readonly id: AgentId }
  | { readonly kind: "good"; readonly id: string }
  | { readonly kind: "place"; readonly key: string }
  /** Una pregunta abierta (sobre alguien o algo), a la espera de respuesta. */
  | { readonly kind: "question"; readonly about: TopicRef; readonly asker: AgentId }
  /** Un hecho dicho hace un momento («lo de ayer»): qué se afirmó sobre quién. */
  | { readonly kind: "claim"; readonly about: AgentId; readonly claim: string };

export interface TopicEntry {
  readonly ref: TopicRef;
  /** Turno de la conversación en que se nombró por última vez. */
  readonly turn: number;
  /** Cuántas veces se nombró (sostenido: pesa más). */
  readonly mentions: number;
}

export interface TopicStack {
  readonly turn: number;
  readonly entries: readonly TopicEntry[];
}

export const EMPTY_TOPICS: TopicStack = { turn: 0, entries: [] };
/** Cuántos temas tiene presentes a la vez. */
export const TOPIC_CAPACITY = 8;
/** Turnos sin nombrarse tras los cuales un tema sale (salvo pregunta abierta). */
export const TOPIC_LIFETIME = 10;

export function refKey(r: TopicRef): string {
  switch (r.kind) {
    case "person":
    case "good":
      return `${r.kind}:${r.id}`;
    case "place":
      return `place:${r.key}`;
    case "question":
      return `question:${r.asker}:${refKey(r.about)}`;
    case "claim":
      return `claim:${r.about}:${r.claim}`;
  }
}

/** Pasa un turno: lo viejo sale; las preguntas abiertas se quedan. */
export function advanceTopics(s: TopicStack): TopicStack {
  const turn = s.turn + 1;
  return {
    turn,
    entries: s.entries.filter((e) => e.ref.kind === "question" || turn - e.turn <= TOPIC_LIFETIME),
  };
}

/** Nombra `ref`: sube al tope; si no entran todos, sale el más viejo que no sea pregunta. */
export function mention(s: TopicStack, ref: TopicRef): TopicStack {
  const key = refKey(ref);
  const prev = s.entries.find((e) => refKey(e.ref) === key);
  const rest = s.entries.filter((e) => refKey(e.ref) !== key);
  const entry: TopicEntry = { ref, turn: s.turn, mentions: (prev?.mentions ?? 0) + 1 };
  let all = [...rest, entry];
  while (all.length > TOPIC_CAPACITY) {
    const drop = all.findIndex((e) => e.ref.kind !== "question" && e !== entry);
    all = drop < 0 ? all.slice(1) : all.filter((_, i) => i !== drop);
  }
  return { turn: s.turn, entries: all };
}

/** Cambio de tema: las preguntas abiertas se dejan (se evadieron) y entra `to`, si lo hay. */
export function changeTopic(s: TopicStack, to?: TopicRef): TopicStack {
  const kept: TopicStack = {
    turn: s.turn,
    entries: s.entries.filter((e) => e.ref.kind !== "question"),
  };
  return to ? mention(kept, to) : kept;
}

/** Contestar una pregunta la cierra. */
export function answer(s: TopicStack, about: TopicRef, asker: AgentId): TopicStack {
  const key = refKey({ kind: "question", about, asker });
  return { turn: s.turn, entries: s.entries.filter((e) => refKey(e.ref) !== key) };
}

export type OpenQuestion = Extract<TopicRef, { kind: "question" }>;

/** Las preguntas abiertas, la más nueva primero. */
export function openQuestions(s: TopicStack): readonly OpenQuestion[] {
  const out: OpenQuestion[] = [];
  for (const e of [...s.entries].reverse()) if (e.ref.kind === "question") out.push(e.ref);
  return out;
}

/** Qué clase de cosa señala una palabra de referencia. */
export type ReferenceClass = "person" | "thing" | "place" | "claim";

/** Cómo se resuelve una palabra: la clase y, si hace falta, un filtro sobre la persona. */
export interface ReferenceWord {
  readonly cls: ReferenceClass;
  /** Excluye a estos (p. ej. quien habla y el oyente: «él» no es ninguno de los dos). */
  readonly not?: readonly AgentId[];
  /** Filtro de la persona a la que se puede referir (género, edad), sabido por quien entiende. */
  readonly fits?: (id: AgentId) => boolean;
}

export type Resolution =
  | { readonly status: "resolved"; readonly ref: TopicRef }
  /** Varios candidatos igual de presentes: hay que preguntar «¿quién?». */
  | { readonly status: "ambiguous"; readonly candidates: readonly TopicRef[] }
  | { readonly status: "none" };

const CLASS_OF: Readonly<Record<TopicRef["kind"], ReferenceClass | null>> = {
  person: "person",
  good: "thing",
  place: "place",
  claim: "claim",
  question: null,
};

/**
 * Resuelve contra los temas presentes: el más recientemente nombrado de la clase; si hay empate
 * en el mismo turno gana el más sostenido, y si sigue el empate es ambiguo. Cada lado llama con
 * SU pila.
 */
export function resolveReference(s: TopicStack, word: ReferenceWord): Resolution {
  const fit = s.entries.filter((e) => {
    if (CLASS_OF[e.ref.kind] !== word.cls) return false;
    if (e.ref.kind === "person") {
      if (word.not?.includes(e.ref.id)) return false;
      if (word.fits && !word.fits(e.ref.id)) return false;
    }
    return true;
  });
  if (fit.length === 0) return { status: "none" };
  const top = Math.max(...fit.map((e) => e.turn));
  const latest = fit.filter((e) => e.turn === top);
  const most = Math.max(...latest.map((e) => e.mentions));
  const heavy = latest.filter((e) => e.mentions === most);
  if (heavy.length === 1) return { status: "resolved", ref: (heavy[0] as TopicEntry).ref };
  return { status: "ambiguous", candidates: heavy.map((e) => e.ref) };
}
