// La barra de arriba de la web (player-loop §9, ampliación 2026-10-23): lo básico de un vistazo y
// el ambiente con que se pinta la pantalla (hora, cielo, lugar, gente, cuerpo). Es otro panel del
// personaje, con el mismo muro con la verdad: solo lo que percibe o cree, en bandas, sin números
// de la verdad. El cielo adentro de una casa no se ve: sale «unknown» salvo que se oiga la lluvia.
// La gente sale de los percepts de la escena (los mismos que `onSeen`), no de quién está de verdad.
// Puro: no escribe nada ni gasta RNG.

import {
  LOCATION,
  localHour,
  type Percept,
  type PlaceKind,
  type SpaceKind,
  skyLight,
  spaceLight,
  weatherAt,
} from "../../sim/index.ts";
import { knownEntities } from "./known.ts";
import type { CharacterPanel } from "./panels.ts";
import { MAX_CLEAR_PERCEPTS } from "./view.ts";
import { type AirFeel, type SeasonName, weatherPanel } from "./weather-panel.ts";
import type { LifeWorld } from "./world.ts";

/** El momento del día, con los crepúsculos de `daylight` (5-7 y 17-19). */
export type DayPhase = "night" | "dawn" | "day" | "dusk";

/** El cielo como lo ve (o lo oye, si está bajo techo). */
export type SkyLook = "clear" | "cloudy" | "overcast" | "rain" | "snow" | "unknown";

/** 0 nada, 1 se nota, 2 fuerte, 3 grave (solo el hambre llega a 3). */
export type Level = 0 | 1 | 2 | 3;

export interface Hud {
  /** Hora solar local (0-24): la que lee del sol, la misma del reloj de la escena. */
  readonly hour: number;
  readonly phase: DayPhase;
  readonly light: "dark" | "dim" | "bright";
  readonly sky: SkyLook;
  /** Se oye o se siente viento fuerte. */
  readonly windy: boolean;
  readonly air: AirFeel;
  readonly season: SeasonName;
  readonly place: {
    readonly indoor: boolean;
    readonly home: boolean;
    readonly space: SpaceKind;
    readonly kinds: readonly PlaceKind[];
  };
  readonly people: {
    /** A cuántos ve o nota ahora (de la escena). */
    readonly around: number;
    /** De esos, a cuántos reconoce. */
    readonly known: number;
    /** La escena se cortó en `MAX_CLEAR_PERCEPTS`: puede haber más. */
    readonly more: boolean;
  };
  readonly body: {
    readonly hunger: Level;
    readonly thirst: Level;
    readonly fatigue: Level;
    readonly sleepy: boolean;
    readonly pain: boolean;
    readonly bleeding: Level;
    readonly fever: boolean;
    readonly hurt: boolean;
  };
  readonly coins: number;
}

export function dayPhase(hour: number): DayPhase {
  if (hour >= 7 && hour < 17) return "day";
  if (hour >= 5 && hour < 7) return "dawn";
  if (hour >= 17 && hour < 19) return "dusk";
  return "night";
}

function skyLook(cloud: number, precip: string, indoor: boolean): SkyLook {
  if (precip === "snow") return "snow";
  if (precip !== "none") return "rain";
  if (indoor) return "unknown";
  if (cloud < 0.3) return "clear";
  if (cloud < 0.7) return "cloudy";
  return "overcast";
}

function bodyOf(body: CharacterPanel["body"]): Hud["body"] {
  const all = new Set([...body.general, ...body.zones.flatMap((z) => z.signs)]);
  const level = (...ladder: readonly string[]): Level => {
    for (let i = ladder.length - 1; i >= 0; i--)
      if (all.has(ladder[i] as string)) return (i + 1) as Level;
    return 0;
  };
  return {
    hunger: level("hungry", "starving", "wasting"),
    thirst: level("thirsty", "parched"),
    fatigue: level("tired", "exhausted"),
    sleepy: all.has("sleepy"),
    pain: all.has("in_pain"),
    bleeding: level("bleeding", "bleeding_heavily"),
    fever: all.has("feverish") || all.has("wound_hot"),
    hurt: all.has("bone_broken") || all.has("limping"),
  };
}

/**
 * La barra desde el panel del personaje (cuerpo y lugar ya leídos), las monedas que cuenta y los
 * percepts de la última escena.
 */
export function hudPanel(
  w: LifeWorld,
  character: CharacterPanel,
  coins: number,
  seen: readonly Percept[],
): Hud {
  const now = w.scheduler.now;
  const at = w.truth.get(LOCATION, w.player);
  const node =
    at?.space === undefined ? undefined : w.spaces.spaces.find((s) => s.key === at.space);
  const indoor = node?.indoor ?? false;
  const hour = localHour(w.clock, now, w.map.lonDeg);
  const sky = skyLight(w.map, w.clock, w.seed, now);
  const light = node ? spaceLight(node, sky) : sky;
  const day = weatherAt(w.map, w.clock, w.seed, now);
  const weather = weatherPanel(w);
  const clear = seen.filter((p) => p.detail !== "vague");
  return {
    hour,
    phase: dayPhase(hour),
    light: light < 0.15 ? "dark" : light < 0.5 ? "dim" : "bright",
    sky: skyLook(day.cloud, day.precip.kind, indoor),
    windy: day.windMs >= (indoor ? 12 : 8),
    air: weather.airNow,
    season: weather.season,
    place: {
      indoor,
      home: character.where.home,
      space: node?.kind ?? "open",
      kinds: character.where.placeKinds as readonly PlaceKind[],
    },
    people: {
      around: seen.length,
      known: knownAround(w, seen),
      more: clear.length >= MAX_CLEAR_PERCEPTS,
    },
    body: bodyOf(character.body),
    coins,
  };
}

/**
 * Cuántos de los que tiene cerca conoce: los que reconoció en esta mirada y los de su familia que
 * cree acá (de noche no siempre se distingue la cara, pero sabe que su madre está en la casa).
 */
function knownAround(w: LifeWorld, seen: readonly Percept[]): number {
  const known = new Set<string>();
  for (const p of seen)
    if (p.detail === "identified" && p.sourceEntityId) known.add(p.sourceEntityId);
  for (const k of knownEntities(w)) {
    if (k.kind === "person" && k.relations.length > 0 && k.present && !k.phantom) known.add(k.ref);
  }
  return Math.min(known.size, seen.length);
}
