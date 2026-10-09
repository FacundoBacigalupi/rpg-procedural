// El comando «qué sé de X» (player-loop §9, §12): de las creencias y del libro, solo lo que toca a
// esa persona o cosa. Es un muro con la verdad como el resto de los paneles: dónde está, si vive y
// qué se debe salen de `BELIEFS` y del libro, nunca del estado real. No pasa el tiempo.

import type { AgentId } from "../../core/index.ts";
import { BELIEFS, beliefConfidenceAt, believed, LOCATION } from "../../sim/index.ts";
import { knownEntities, whereaboutsFromBeliefs } from "./known.ts";
import { type BookLine, bookLinesOf } from "./panels.ts";
import { RECOGNIZED_CONFIDENCE } from "./view.ts";
import type { LifeWorld } from "./world.ts";

/** Qué tan firme es una cosa que cree. */
export type AboutSurety = "sure" | "unsure" | "vague";

export interface AboutPanel {
  readonly kind: "person" | "place";
  /** Cómo lo nombró el jugador (el nombre por el que se lo encontró). */
  readonly name: string;
  /** Si cree que vive; `unknown` si no tiene creencia alguna. Solo personas. */
  readonly alive: "alive" | "dead" | "unknown";
  readonly aliveSurety: AboutSurety;
  /** Dónde cree que está: acá, visto en otro lado (hace cuántos días) o sin idea. */
  readonly where:
    | { readonly state: "here" }
    | { readonly state: "elsewhere"; readonly daysAgo: number; readonly surety: AboutSurety }
    | { readonly state: "unknown" };
  /** Las deudas y promesas que lo tocan, como las cree. */
  readonly book: readonly BookLine[];
}

function suretyOf(confidence: number): AboutSurety {
  if (confidence >= 0.7) return "sure";
  if (confidence >= RECOGNIZED_CONFIDENCE) return "unsure";
  return "vague";
}

/** De quién o qué pregunta: el resto de la línea sin el comando ni artículos, o `undefined` si no hay. */
export function aboutTopicText(line: string): string | undefined {
  const rest = line
    .trim()
    .replace(/^¿?qu[eé]\s+s[eé]\s+(?:yo\s+)?(?:de|sobre|acerca de)\s*/iu, "")
    .replace(/[?¿!.]+$/u, "")
    .replace(/^(?:el|la|los|las|mi|mis|un|una)\s+/iu, "")
    .trim()
    .toLowerCase();
  return rest === "" ? undefined : rest;
}

/** Lo que el personaje sabe de `ref` (una persona o lugar que conoce), sin leer la verdad. */
export function aboutPanel(w: LifeWorld, ref: string, name: string): AboutPanel {
  const entity = knownEntities(w).find((k) => k.ref === ref);
  if (entity?.kind !== "person") {
    return {
      kind: "place",
      name,
      alive: "unknown",
      aliveSurety: "vague",
      where: entity?.present ? { state: "here" } : { state: "unknown" },
      book: [],
    };
  }
  const id = ref as AgentId;
  const now = w.scheduler.now;
  const beliefs = w.truth.get(BELIEFS, w.player);
  const lives = believed(beliefs, id, "alive");
  const here = w.truth.get(LOCATION, w.player);
  const seen = whereaboutsFromBeliefs(beliefs, id, here, now);
  const at = believed(beliefs, id, "at");
  const book = bookLinesOf(w)
    .filter((x) => x.ref === id)
    .map((x) => x.line);
  const where: AboutPanel["where"] = seen.believed
    ? seen.present
      ? { state: "here" }
      : {
          state: "elsewhere",
          daysAgo: Math.max(0, Math.round((now - (at?.asOf ?? now)) / w.clock.day)),
          surety: suretyOf(at ? beliefConfidenceAt(at, now) : 0),
        }
    : entity.present
      ? { state: "here" }
      : { state: "unknown" };
  return {
    kind: "person",
    name,
    alive: lives === undefined ? "unknown" : lives.value === true ? "alive" : "dead",
    aliveSurety: lives === undefined ? "vague" : suretyOf(beliefConfidenceAt(lives, now)),
    where,
    book,
  };
}
