// El entorno de las señales de ansia como lo vive el personaje (opt-in): las personas que CREE
// presentes (sus creencias, no la verdad) y el huso local por la longitud del lugar.

import type { AgentId, HolderRef, PlanetClock, Tick } from "../../core/index.ts";
import {
  BELIEFS,
  type Beliefs,
  beliefConfidenceAt,
  believed,
  LOCATION,
  type ReadonlyWorldTruth,
} from "../../sim/index.ts";

// Mismo umbral que `RECOGNIZED_CONFIDENCE` de view.ts (no se importa: view -> world cierra un ciclo
// con decide).
const PRESENT_CONFIDENCE = 0.2;

type Here = { readonly hex: unknown; readonly space?: unknown } | undefined;

function believesPresent(
  beliefs: Beliefs | undefined,
  id: AgentId,
  here: Here,
  now: Tick,
): boolean {
  const b = believed(beliefs, id, "at");
  if (b === undefined || typeof b.value === "boolean" || typeof b.value === "string") return false;
  if (beliefConfidenceAt(b, now) < PRESENT_CONFIDENCE || !here) return false;
  return b.value.hex === here.hex && b.value.space === here.space;
}

export interface CueLocal {
  readonly believedPresent: readonly string[];
  readonly hourOffset: number;
}

/**
 * Los objetos a la vista (puro): de los bienes que remiten a una sustancia, los que cree tener a
 * mano (`have` >= 1 en lo que ve o lleva). Ver el objeto despierta la señal por objeto (`obj:<bien>`).
 */
export function objectsSeen(
  goods: readonly string[],
  have: (good: string) => number,
): readonly string[] {
  return [...new Set(goods)].filter((g) => have(g) >= 1).sort();
}

/**
 * Quién tiene a la vista (puro, percepción): las personas que de verdad están en su mismo lugar
 * (hex y espacio; no se ve lo que está en otra parte aunque lo crea) y a las que no está ciego,
 * ordenadas. Lo que se ve de ellas es lo que llevan, nunca su despensa de casa.
 */
export function peopleInView(truth: ReadonlyWorldTruth, who: AgentId): readonly AgentId[] {
  const here = truth.get(LOCATION, who);
  if (!here) return [];
  const out: AgentId[] = [];
  for (const id of truth.ids(LOCATION)) {
    if (id === who || !id.startsWith("agent:")) continue;
    const there = truth.get(LOCATION, id as AgentId);
    if (!there || there.hex !== here.hex || there.space !== here.space) continue;
    out.push(id as AgentId);
  }
  return out.sort();
}

/**
 * Los objetos que ve en lotes ajenos (lo que llevan los presentes y los puestos del lugar), sin
 * repetir y ordenados; se suma a lo propio con `objectsSeen`. `visible` dice cuánto de un bien
 * está a la vista en ese lote (un lote guardado o tapado no cuenta: devuelve 0).
 */
export function objectsInView(
  goods: readonly string[],
  lots: readonly ((good: string) => number)[],
): readonly string[] {
  return objectsSeen(goods, (g) => lots.reduce((n, visible) => n + visible(g), 0));
}

export function cueLocalOf(
  truth: ReadonlyWorldTruth,
  who: AgentId,
  now: Tick,
  _clock: PlanetClock,
  lonDeg: number,
): CueLocal {
  const beliefs = truth.get(BELIEFS, who);
  const here = truth.get(LOCATION, who);
  const subjects = new Set<AgentId>();
  for (const b of beliefs?.items ?? []) if (b.prop.attr === "at") subjects.add(b.prop.subject);
  const believedPresent: string[] = [];
  for (const id of subjects) {
    if (id === who) continue;
    if (believesPresent(beliefs, id, here, now)) believedPresent.push(id);
  }
  believedPresent.sort();
  return { believedPresent, hourOffset: Math.round(lonDeg / 15) };
}

/** Opt-in de lo que se ve en lotes ajenos: los puestos del hex y, aparte, lo tirado en el suelo. */
export interface ViewCues {
  readonly stalls?: (hex: number) => readonly HolderRef[];
  /**
   * Lotes sin dueño tirados o dejados en el hex y espacio del personaje (el lugar donde están,
   * `PlaceRef`); se piden solo para donde está, no hay vista a distancia.
   */
  readonly ground?: (hex: number, space: string | undefined) => readonly HolderRef[];
}

/**
 * Los tenedores de lotes a la vista en el lugar del personaje (puro, percepción): los puestos del
 * hex y el suelo de su mismo hex y espacio. Sin ubicación no ve nada.
 */
export function placeHoldersInView(
  cues: ViewCues,
  here: { readonly hex: number; readonly space?: string } | undefined,
): readonly HolderRef[] {
  if (!here) return [];
  return [...(cues.stalls?.(here.hex) ?? []), ...(cues.ground?.(here.hex, here.space) ?? [])];
}
