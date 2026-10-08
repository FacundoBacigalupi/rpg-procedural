// Los actos de habla de la conversación mínima (dialogue §2): lo que el oyente entiende de lo que
// le dijeron. El texto del personaje llega tal cual (el LLM no lo reinterpreta); entender es del
// oyente y es léxico: reconoce un saludo, una pregunta por alguien, un pedido de algo, algo que
// le cuentan. Lo que no encaja es `other`, y el oyente lo toma como charla.

import type { AgentId } from "../../core/index.ts";
import type { Appeal } from "./persuasion.ts";

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
  /** Una propuesta de intercambio (dialogue §2): lo que quien habla da y lo que quiere (null: nada). */
  | {
      readonly kind: "offer";
      readonly give: ExchangeTerm | null;
      readonly want: ExchangeTerm | null;
    }
  /** Acepta o rechaza la propuesta abierta entre los dos (la que el oyente dejó planteada). */
  | { readonly kind: "accept" | "refuse" }
  /** Un argumento para que el oyente haga o crea algo: a qué apunta (dialogue §6); `persuade` lo pesa. */
  | { readonly kind: "argue"; readonly reason: ArgueReason }
  | { readonly kind: "other" };

/**
 * La razón que se da, tal como se entiende de las palabras (dialogue §6). `face` sin `whose`
 * apunta a la cara del propio oyente; `relation` sin `with` no se entiende de quién.
 */
export type ArgueReason =
  | { readonly kind: "relation"; readonly with: AgentId | null }
  | { readonly kind: "norm"; readonly norm: string }
  | { readonly kind: "fear"; readonly danger: string }
  | { readonly kind: "face"; readonly whose: AgentId | null }
  | { readonly kind: "authority"; readonly source: string }
  | { readonly kind: "reciprocity"; readonly favor: string };

/** El `Appeal` de una razón dicha a `listener`; null si no queda claro a qué apunta. */
export function appealOf(reason: ArgueReason, listener: AgentId): Appeal | null {
  switch (reason.kind) {
    case "relation":
      return reason.with === null ? null : { kind: "relation", with: reason.with };
    case "norm":
      return { kind: "norm", norm: reason.norm };
    case "fear":
      return { kind: "fear", danger: reason.danger };
    case "face":
      return { kind: "face", whose: reason.whose ?? listener };
    case "authority":
      return { kind: "authority", source: reason.source };
    case "reciprocity":
      return { kind: "reciprocity", favor: reason.favor };
  }
}

/** Un término de intercambio: cuántos gramos de qué bien (dialogue §2, `ExchangeTerm`). */
export interface ExchangeTerm {
  readonly good: string;
  readonly grams: number;
}

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

const OFFER_GIVES = /\b(te ofrezco|te propongo|te doy|te cambio|te vendo|te dejo|trueque)\b/;
const OFFER_BUYS = /\b(te compro|te pago)\b/;
const SWAP = / (por|a cambio de) /;
const ACCEPT = /\b(acepto|trato hecho|de acuerdo|me parece bien|hecho|dale|esta bien)\b/;
const REFUSE = /\b(no acepto|no gracias|olvidalo|no me interesa|ni hablar|no quiero)\b/;
const SHORT_UTTERANCE_WORDS = 6;

// El léxico de razones (dialogue §6): las frases con que se da un motivo, no un orden.
const REASON_RELATION =
  /(hazlo por|hacelo por|por el bien de|piensa en|pensa en|hazlo pensando en)/;
const REASON_NORM =
  /(es la costumbre|es costumbre|se acostumbra|es lo que se hace|asi se hace|es la tradicion|es lo correcto|es lo justo)/;
const REASON_FEAR =
  /(te van a matar|te vas a morir|vas a morir|te va a pasar algo|es peligroso|corres peligro|te van a hacer dano|te va a ir mal)/;
const REASON_FACE =
  /(quedas mal|quedaras mal|que van a decir|que diran|tu honor|tu nombre|tu fama|te vas a avergonzar|por tu reputacion)/;
const REASON_AUTHORITY =
  /(lo manda|lo ordena|lo dice el (anciano|jefe|senor|maestro|sacerdote)|lo dijo el (anciano|jefe|senor|maestro|sacerdote)|es una orden)/;
const REASON_RECIPROCITY =
  /(me debes|me lo debes|te ayude|te hice un favor|acordate de lo que hice|despues de todo lo que hice)/;
const AUTHORITY_SOURCE = /(anciano|jefe|senor|maestro|sacerdote)/;

/** La razón que se da en `norm` (ya normalizado), o null si no da ninguna. */
function reasonIn(norm: string, who: AgentId | null): ArgueReason | null {
  if (REASON_FEAR.test(norm)) return { kind: "fear", danger: "death" };
  if (REASON_FACE.test(norm)) return { kind: "face", whose: null };
  if (REASON_AUTHORITY.test(norm)) {
    return { kind: "authority", source: AUTHORITY_SOURCE.exec(norm)?.[1] ?? "command" };
  }
  if (REASON_RECIPROCITY.test(norm)) return { kind: "reciprocity", favor: "past_favor" };
  if (REASON_NORM.test(norm)) return { kind: "norm", norm: "custom" };
  if (REASON_RELATION.test(norm)) return { kind: "relation", with: who };
  return null;
}

function mentions(norm: string, names: readonly string[]): boolean {
  return names.some((n) => {
    const w = normalize(n);
    return w.length > 0 && new RegExp(`(^| )${w}( |$)`).test(norm);
  });
}

/** El bien y la cantidad (mil gramos si no dice) que nombra un tramo de frase. */
function termIn(seg: string, lex: Lexicon): ExchangeTerm | null {
  const good = lex.goods.find((g) => mentions(seg, g.names))?.id;
  if (good === undefined) return null;
  const m = AMOUNT.exec(seg);
  const grams = m ? Number(m[1]) * (m[2]?.startsWith("k") ? 1000 : 1) : 1000;
  return { good, grams };
}

/** Con la voz turbia llega que da una razón, pero no el detalle de quién. */
function blurred(r: ArgueReason): ArgueReason {
  return r.kind === "relation" ? { kind: "relation", with: null } : r;
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
  const gives = OFFER_GIVES.test(norm);
  if (gives || OFFER_BUYS.test(norm)) {
    // "te doy A por B": quien habla da A y quiere B; "te compro A por B": quiere A y da B.
    const [left = "", right = ""] = norm.split(SWAP).filter((_p, i) => i !== 1);
    const a = blur ? null : termIn(left, lex);
    const b = blur ? null : termIn(right, lex);
    return gives ? { kind: "offer", give: a, want: b } : { kind: "offer", give: b, want: a };
  }
  if (ASK.test(norm)) return { kind: "ask", about: blur ? null : who };
  if (who !== null && !blur && (DEAD.test(norm) || (TELL.test(norm) && ALIVE.test(norm)))) {
    return { kind: "tell", about: who, claim: DEAD.test(norm) ? "dead" : "alive" };
  }
  const reason = reasonIn(norm, blur ? null : who);
  if (reason !== null) return { kind: "argue", reason: blur ? blurred(reason) : reason };
  const brief = norm.split(" ").length <= SHORT_UTTERANCE_WORDS;
  if (REFUSE.test(norm) && brief) return { kind: "refuse" };
  if (ACCEPT.test(norm) && brief) return { kind: "accept" };
  if (FAREWELL.test(norm)) return { kind: "farewell" };
  if (GREET.test(norm)) return { kind: "greet" };
  return { kind: "other" };
}
