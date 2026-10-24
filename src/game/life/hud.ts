// La barra de arriba de la web (player-loop §9, ampliación 2026-10-23): lo básico de un vistazo y
// el ambiente con que se pinta la pantalla (hora, cielo, lugar, gente, cuerpo). Es otro panel del
// personaje, con el mismo muro con la verdad: solo lo que percibe o cree, en bandas, sin números
// de la verdad. El cielo adentro de una casa no se ve: sale «unknown» salvo que se oiga la lluvia.
// La gente sale de los percepts de la escena (los mismos que `onSeen`), no de quién está de verdad.
// El ánimo es lo que siente de sí (emociones propias con su decaimiento y la carga más pesada) y el
// frío o el calor, lo que el cuerpo le dice del núcleo (`THERMAL`): ambos son de adentro, no de la
// verdad ajena. Puro: no escribe nada ni gasta RNG.

import {
  CORE_NORMAL_C,
  type ConditionKind,
  EMOTION_HALF_LIFE_TICKS,
  EMOTIONS,
  type EmotionId,
  emotionIntensityAt,
  INNATE,
  LOCATION,
  localHour,
  type Percept,
  type PlaceKind,
  type SpaceKind,
  skyLight,
  spaceLight,
  THERMAL,
  weatherAt,
} from "../../sim/index.ts";
import { knownEntities } from "./known.ts";
import type { BurdenLevel, CharacterPanel } from "./panels.ts";
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
  /**
   * Cómo se siente por dentro: la emoción más fuerte que todavía le dura (1 se nota, 2 fuerte) y la
   * carga más pesada que lleva (duelo, culpa…), en bandas. Sin nada, `feeling` es `null`.
   */
  readonly mood: {
    readonly feeling: EmotionId | null;
    readonly strength: 0 | 1 | 2;
    readonly burden: { readonly kind: ConditionKind; readonly weight: BurdenLevel } | null;
  };
  /** El frío o el calor que siente en el cuerpo (el núcleo), no el aire: «normal» sin desvío. */
  readonly warmth: Warmth;
}

/** De helado (núcleo muy bajo) a ardiendo (muy alto). */
export type Warmth = "freezing" | "cold" | "normal" | "hot" | "burning";

/** Desde qué intensidad (0-1, ya decaída) una emoción se nota, y desde cuál es fuerte. */
export const MOOD_FAINT = 0.15;
export const MOOD_STRONG = 0.5;

/** Núcleo (°C) bajo el que tirita de frío, bajo el que está helado, y sobre los que siente calor. */
export const WARMTH_COLD_C = CORE_NORMAL_C - 0.5;
export const WARMTH_FREEZING_C = CORE_NORMAL_C - 2;
export const WARMTH_HOT_C = CORE_NORMAL_C + 0.8;
export const WARMTH_BURNING_C = CORE_NORMAL_C + 2;

export function warmthOf(coreC: number | undefined): Warmth {
  if (coreC === undefined) return "normal";
  if (coreC < WARMTH_FREEZING_C) return "freezing";
  if (coreC < WARMTH_COLD_C) return "cold";
  if (coreC >= WARMTH_BURNING_C) return "burning";
  if (coreC >= WARMTH_HOT_C) return "hot";
  return "normal";
}

const BURDEN_RANK: Record<BurdenLevel, number> = { light: 0, heavy: 1, crushing: 2 };

function moodOf(w: LifeWorld, character: CharacterPanel): Hud["mood"] {
  const innate = w.truth.get(INNATE, w.player);
  const reactivity = Math.min(1, Math.max(0, ((innate?.["reactivity"] ?? 0) + 1) / 2));
  let feeling: EmotionId | null = null;
  let top = 0;
  for (const s of w.truth.get(EMOTIONS, w.player)?.signals ?? []) {
    if (s.owner !== w.player) continue;
    const halfLifeTicks = EMOTION_HALF_LIFE_TICKS[s.emotion];
    const x = emotionIntensityAt(s, w.scheduler.now, { halfLifeTicks, reactivity });
    if (x > top || (x === top && feeling !== null && s.emotion < feeling)) {
      top = x;
      feeling = s.emotion;
    }
  }
  if (top < MOOD_FAINT) feeling = null;
  let burden: Hud["mood"]["burden"] = null;
  for (const b of character.conscience?.burdens ?? [])
    if (!burden || BURDEN_RANK[b.weight] > BURDEN_RANK[burden.weight]) burden = b;
  return {
    feeling,
    strength: feeling === null ? 0 : top >= MOOD_STRONG ? 2 : 1,
    burden,
  };
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
    mood: moodOf(w, character),
    warmth: warmthOf(w.truth.get(THERMAL, w.player)?.coreC),
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
