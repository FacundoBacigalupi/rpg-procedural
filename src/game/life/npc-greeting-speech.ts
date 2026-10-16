// El saludo de los viajeros con la lengua y el acento de cada uno (language §5, dialogue §5,
// `npc-b2b4c2b3`). El texto sale del léxico de la lengua (tratamiento + nombre de pila del oyente,
// `renderAddress`) detrás del saludo; la claridad con que lo oye el otro sale de la distancia entre
// los acentos nativos (`accentDistance`) y de su oído (`earOf`), y de si hablan la misma lengua.
//
// Hoy no hay una lengua ni una comunidad por persona: todos nacen en la aldea, así que `nativeOf`
// por defecto devuelve la lengua y el acento de la aldea (`COMMUNITY_ACCENT`) y la claridad es 1.
// Con una comunidad por persona se inyecta otra `nativeOf` y el resto ya funciona.

import type { AgentId } from "../../core/index.ts";
import {
  ACCENT_JND,
  type Accent,
  type AddressDef,
  accentDistance,
  COMMUNITY_ACCENT,
  callName,
  chooseAddress,
  type Language,
  PERSON_NAME,
  type ReadonlyWorldTruth,
  renderAddress,
} from "../../sim/index.ts";
import { earOf } from "./accent.ts";
import type { GreetingSpeech } from "./npc-greetings.ts";
import { villageOf } from "./taboos.ts";

/** Cuánta claridad se pierde por punto de distancia de acento sobre lo que no se nota (sin calibrar). */
export const ACCENT_CLARITY_LOSS = 3;
/** Cuánto del desgaste del acento compensa el mejor oído (0-1; sin calibrar). */
export const EAR_COMPENSATION = 0.5;

export interface Native {
  readonly language: string;
  readonly accent: Accent;
}

/** La lengua y el acento nativo de cada uno; hoy el de la aldea para todos. */
export function villageNative(truth: ReadonlyWorldTruth): Native | undefined {
  const village = villageOf(truth);
  const row = village === undefined ? undefined : truth.get(COMMUNITY_ACCENT, village);
  return row ? { language: row.language, accent: row.accent } : undefined;
}

/**
 * Qué tan claro lo oye `hearer` (0-1): otra lengua es 0 (no se entiende); la misma, 1 menos lo que
 * pesa la distancia de acento por encima de lo que no se nota, atenuada por el oído de quien oye.
 */
export function greetingClarity(
  truth: ReadonlyWorldTruth,
  speaker: AgentId,
  hearer: AgentId,
  nativeOf: (truth: ReadonlyWorldTruth, who: AgentId) => Native | undefined,
): number {
  const a = nativeOf(truth, speaker);
  const b = nativeOf(truth, hearer);
  if (!a || !b) return 1;
  if (a.language !== b.language) return 0;
  const gap = Math.max(0, accentDistance(a.accent, b.accent) - ACCENT_JND);
  const loss = gap * ACCENT_CLARITY_LOSS * (1 - EAR_COMPENSATION * earOf(truth, hearer));
  return Math.min(1, Math.max(0, 1 - loss));
}

export interface GreetingLanguage {
  readonly language: Language;
  readonly addresses: readonly AddressDef[];
  readonly culture: string;
}

/**
 * El saludo de palabras armado con la lengua: el saludo y, detrás, cómo trata al otro (el
 * honorífico de la lengua si la cultura lo pide entre iguales, y su nombre de pila).
 */
export function lexicalGreetingSpeech(
  lang: GreetingLanguage,
  nativeOf: (truth: ReadonlyWorldTruth, who: AgentId) => Native | undefined = villageNative,
): GreetingSpeech {
  return {
    say: (_speaker, hearer, truth) => {
      const name = truth.get(PERSON_NAME, hearer);
      const given = name ? (callName(name) ?? "") : "";
      const form = chooseAddress(lang.addresses, lang.culture, "peer", 0.5);
      const to = renderAddress(lang.language, form, given).trim();
      return to === "" ? "Buenas" : `Buenas, ${to}`;
    },
    lexicon: { people: [], goods: [] },
    clarity: (truth, speaker, hearer) => greetingClarity(truth, speaker, hearer, nativeOf),
  };
}
