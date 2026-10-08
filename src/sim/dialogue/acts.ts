// Los actos de habla de la conversación mínima (dialogue §2): lo que el oyente entiende de lo que
// le dijeron. El texto del personaje llega tal cual (el LLM no lo reinterpreta); entender es del
// oyente y es léxico: reconoce un saludo, una pregunta por alguien, un pedido de algo, algo que
// le cuentan. Lo que no encaja es `other`, y el oyente lo toma como charla.

import type { AgentId } from "../../core/index.ts";

export type SpeechAct =
  | { readonly kind: "greet" }
  | { readonly kind: "farewell" }
  /** ¿Dónde está `about`? (null: no dijo de quién, o de alguien que el oyente no conoce). */
  | { readonly kind: "ask"; readonly about: AgentId | null }
  /** Un pedido de `good` (un id de bien); null si no se entiende qué. */
  | { readonly kind: "request"; readonly good: string | null }
  /** Le cuentan que `about` murió o sigue vivo. */
  | { readonly kind: "tell"; readonly about: AgentId; readonly claim: "dead" | "alive" }
  /** Quien habla promete devolver o dar `good` (cuántos gramos si lo dijo; null si no). */
  | { readonly kind: "promise"; readonly good: string | null; readonly grams: number | null }
  | { readonly kind: "other" };

/** Con qué palabras puede nombrar el oyente a alguien o algo. */
export interface Lexicon {
  readonly people: readonly { readonly id: AgentId; readonly names: readonly string[] }[];
  readonly goods: readonly { readonly id: string; readonly names: readonly string[] }[];
}

/** Minúsculas, sin tildes ni signos, con espacios simples. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const GREET = /\b(hola|buen dia|buenos dias|buenas tardes|buenas noches|buenas|saludos|que tal)\b/;
const FAREWELL = /\b(adios|chau|chao|hasta luego|hasta manana|nos vemos|me voy|que te vaya bien)\b/;
const ASK = /\b(donde (esta|anda|queda|se metio)|sabes donde|has visto a|viste a)\b/;
const REQUEST =
  /\b(dame|dam[eé]lo|podes darme|me das|me daria[sn]?|necesito|presta(me)?|pasame|regalame|dejame)\b/;
const DEAD = /\b(murio|esta muert[oa]|fallecio|lo mataron|la mataron)\b/;
const ALIVE = /\b(esta vivo|esta viva|sigue vivo|sigue viva|esta bien|no murio)\b/;
const TELL = /\b(te cuento|sabes que|me dijeron que|escuche que|te aviso|ya sabes)\b/;

const PROMISE =
  /\b(te prometo|te juro|te doy mi palabra|palabra que|te lo devuelvo|te lo pago|te devuelvo|te pago|cuenta conmigo)\b/;
const AMOUNT = /\b(\d{1,6}) ?(kilos?|kg|gramos?|g)\b/;

function mentions(norm: string, names: readonly string[]): boolean {
  return names.some((n) => {
    const w = normalize(n);
    return w.length > 0 && new RegExp(`(^| )${w}( |$)`).test(norm);
  });
}

/** Lo que el oyente entiende de `text`; con `clarity` baja, solo capta lo grueso (dialogue §5). */
export function understand(text: string, lex: Lexicon, clarity = 1): SpeechAct {
  const norm = normalize(text);
  const who = lex.people.find((p) => mentions(norm, p.names))?.id ?? null;
  const good = lex.goods.find((g) => mentions(norm, g.names))?.id ?? null;
  // Con la voz turbia se entiende una cosa u otra, pero no el detalle: ni de quién ni de qué.
  const blur = clarity < 0.35;
  if (REQUEST.test(norm)) return { kind: "request", good: blur ? null : good };
  if (PROMISE.test(norm)) {
    const m = AMOUNT.exec(norm);
    const n = m ? Number(m[1]) * (m[2]?.startsWith("k") ? 1000 : 1) : null;
    return { kind: "promise", good: blur ? null : good, grams: blur ? null : n };
  }
  if (ASK.test(norm)) return { kind: "ask", about: blur ? null : who };
  if (who !== null && !blur && (DEAD.test(norm) || (TELL.test(norm) && ALIVE.test(norm)))) {
    return { kind: "tell", about: who, claim: DEAD.test(norm) ? "dead" : "alive" };
  }
  if (FAREWELL.test(norm)) return { kind: "farewell" };
  if (GREET.test(norm)) return { kind: "greet" };
  return { kind: "other" };
}
