// La barra de arriba de la web (player-loop §9, ampliación 2026-10-23): lo básico de un vistazo y
// el ambiente con que se pinta la pantalla (hora, cielo, lugar, gente, cuerpo). Es otro panel del
// personaje, con el mismo muro con la verdad: solo lo que percibe o cree, en bandas, sin números
// de la verdad. El cielo adentro de una casa no se ve: sale «unknown» salvo que se oiga la lluvia.
// La gente sale de los percepts de la escena (los mismos que `onSeen`), no de quién está de verdad.
// El ánimo es lo que siente de sí (emociones propias con su decaimiento y la carga más pesada) y el
// frío o el calor, lo que el cuerpo le dice del núcleo (`THERMAL`): ambos son de adentro, no de la
// verdad ajena. La luna y las estrellas, solo si las ve: afuera, con el cielo abierto y la luna sobre
// el horizonte (cosmology §2, `moonAt`); la fase sale de mirarla, no de un calendario. El peligro es
// el que cree tener cerca: lo que lee que hacen los que ve (la apuesta del verbo) y lo que teme de
// los que reconoce (miedo de la relación y recuerdos que duelen, `otherBeliefFrom`), con la
// confianza de lo leído; nunca quién es de verdad ni qué trama.
// Los edificios son los del asentamiento (settlements): cosas grandes y quietas que se ven desde
// donde está, afuera y con la luz que haya; de cada uno, el tipo, de qué se ven las paredes y el
// techo, si está gastado, caído o ardiendo. Adentro, el edificio donde está.
// Puro: no escribe nada ni gasta RNG.

import { type AgentId, type HolderRef, holderAccount } from "../../core/index.ts";
import {
  type AgeBand,
  BODY_STATE,
  BUILDING,
  type BuildingRecord,
  CORE_NORMAL_C,
  type ConditionKind,
  EMOTION_HALF_LIFE_TICKS,
  EMOTIONS,
  type EmotionId,
  ENTITY,
  emotionIntensityAt,
  HEARTH,
  INNATE,
  LOCATION,
  localHour,
  MEMORIES,
  MIND,
  moonAt,
  otherBeliefFrom,
  type Percept,
  type PlaceKind,
  RELATIONS,
  relationship,
  type Sex,
  type SpaceKind,
  STAKES_RISK,
  skyLight,
  skyObserverOf,
  spaceLight,
  THERMAL,
  unitGrams,
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
    /**
     * Adentro, un fuego encendido en el mismo cuarto (lo ve y lo siente). Sin fuegos simulados en la
     * vida (`HEARTH` vacía: los hogares son opt-in) no se sabe: `undefined`, y el fondo pinta como antes.
     */
    readonly fire?: boolean;
    /**
     * Los edificios que ve desde donde está (afuera, en el asentamiento), de oeste a este. Sin
     * edificios en la vida (aldea de respaldo sin `BUILDING`), `undefined`: el fondo pinta como antes.
     */
    readonly buildings?: readonly SeenBuilding[];
    /** Adentro de un edificio: cuál es. */
    readonly building?: Omit<SeenBuilding, "x" | "d">;
  };
  readonly people: {
    /** A cuántos ve o nota ahora (de la escena). */
    readonly around: number;
    /** De esos, a cuántos reconoce. */
    readonly known: number;
    /** La escena se cortó en `MAX_CLEAR_PERCEPTS`: puede haber más. */
    readonly more: boolean;
    /**
     * Cómo se ve cada uno, en el orden de la escena: solo lo que leyó la mirada (edad y sexo de la
     * figura, la ropa); de quien apenas nota, nada (una sombra).
     */
    readonly figures: readonly SeenFigure[];
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
  /** La luna que ve (la primera del planeta), con su fase y qué tan alta está; si no la ve, `null`. */
  readonly moon: { readonly phase: MoonPhaseName; readonly high: boolean } | null;
  /** Las estrellas que ve: ninguna (día, nubes, techo), algunas o muchas. */
  readonly stars: "none" | "few" | "many";
  /**
   * El peligro que cree tener cerca: 0 nada, 1 inquieta, 2 amenaza, 3 grave; y de cuántos de los que
   * ve viene (desde la inquietud).
   */
  readonly danger: { readonly level: Level; readonly from: number };
  /**
   * Lo que pesa lo que lleva encima, en bandas sobre su propio peso (`LOAD_BANDS`): 0 apenas nada,
   * 1 cargado, 2 pesado, 3 al límite. El cuerpo lo siente aunque no lo haya contado.
   */
  readonly load: Level;
}

/**
 * Fracción del peso del cuerpo desde la que la carga se siente (cargado, pesado, al límite): un
 * cuarto del peso se lleva todo el día; la mitad, a duras penas. Calibración abierta.
 */
export const LOAD_BANDS = [0.1, 0.25, 0.45] as const;

/** La banda de carga de lo que lleva el personaje, por los gramos de sus bienes y monedas. */
export function loadOf(w: LifeWorld): Level {
  const massKg = w.truth.get(BODY_STATE, w.player)?.massKg;
  if (massKg === undefined || massKg <= 0) return 0;
  let grams = 0;
  for (const h of w.ledger.holdings(holderAccount(w.player as HolderRef))) {
    if (h.amount > 0) grams += unitGrams(w.goods, h.unit, h.amount);
  }
  const fraction = grams / 1000 / massKg;
  const band = LOAD_BANDS.filter((b) => fraction >= b).length;
  return band as Level;
}

/** La fase de la luna en ocho, como se nombra a ojo. */
export type MoonPhaseName =
  | "new"
  | "waxing_crescent"
  | "first_quarter"
  | "waxing_gibbous"
  | "full"
  | "waning_gibbous"
  | "last_quarter"
  | "waning_crescent";

const MOON_PHASES: readonly MoonPhaseName[] = [
  "new",
  "waxing_crescent",
  "first_quarter",
  "waxing_gibbous",
  "full",
  "waning_gibbous",
  "last_quarter",
  "waning_crescent",
];

/** La fase (0-1, 0 luna nueva) en ocho tramos centrados: 0.5 es llena. */
export function moonPhaseName(phase: number): MoonPhaseName {
  return MOON_PHASES[Math.floor(phase * 8 + 0.5) % 8] as MoonPhaseName;
}

/** Altura (radianes) desde la que la luna se cuenta alta: unos 30°. */
const MOON_HIGH_RAD = Math.PI / 6;
/** Iluminación desde la que la luna apaga las estrellas débiles. */
const MOON_BRIGHT = 0.6;

/** Lo que ve del cielo de noche: luna sobre el horizonte y estrellas, con el techo y las nubes. */
export function nightSky(
  look: { readonly indoor: boolean; readonly sky: SkyLook; readonly phase: DayPhase },
  moon: { readonly phase: number; readonly illumination: number; readonly altitude: number } | null,
): Pick<Hud, "moon" | "stars"> {
  const open = !look.indoor && (look.sky === "clear" || look.sky === "cloudy");
  const name = moon ? moonPhaseName(moon.phase) : "new";
  const seen = open && moon !== null && moon.altitude > 0 && name !== "new" ? moon : null;
  const dark = look.phase === "night";
  const stars: Hud["stars"] =
    !open || !dark
      ? "none"
      : look.sky === "clear" && (seen === null || seen.illumination < MOON_BRIGHT)
        ? "many"
        : "few";
  return {
    moon: seen ? { phase: name, high: seen.altitude >= MOON_HIGH_RAD } : null,
    stars,
  };
}

/** Desde qué amenaza creída (0-1) inquieta, amenaza y es grave. */
export const DANGER_UNEASY = 0.2;
export const DANGER_THREAT = 0.45;
export const DANGER_ACUTE = 0.7;

/**
 * El peligro desde lo que ve: por cada percept, la apuesta de lo que lee que hace (`riskOf` de la
 * acción leída) y lo que teme de quien cree que es (`threatOf` de la identidad leída), cada uno por
 * la confianza de su lectura. Un mismo conocido en varios percepts cuenta una vez.
 */
export function dangerOf(
  seen: readonly Percept[],
  threatOf: (who: AgentId) => number,
  riskOf: (action: string) => number,
): Hud["danger"] {
  let top = 0;
  const from = new Set<string>();
  for (const p of seen) {
    let t = 0;
    const action = p.fields.action;
    if (typeof action?.value === "string" && action.confidence > 0)
      t = riskOf(action.value) * action.confidence;
    const id = p.fields.identity;
    const who =
      typeof id?.value === "string" && id.value.startsWith("agent:") && id.confidence > 0
        ? (id.value as AgentId)
        : undefined;
    if (who && id) t = Math.max(t, threatOf(who) * id.confidence);
    if (t >= DANGER_UNEASY) from.add(who ?? p.id);
    top = Math.max(top, t);
  }
  const level: Level =
    top >= DANGER_ACUTE ? 3 : top >= DANGER_THREAT ? 2 : top >= DANGER_UNEASY ? 1 : 0;
  return { level, from: from.size };
}

/** Ver pelear asusta como una amenaza aunque el verbo no declare qué se juega. */
export const COMBAT_SEEN_RISK = 0.5;

/**
 * La apuesta de un verbo leído (`action.<verbo>`) en el catálogo, y pelear como amenaza; lo demás
 * no asusta.
 */
function riskOfIn(w: LifeWorld): (action: string) => number {
  return (action) => {
    if (!action.startsWith("action.")) return 0;
    const def = w.catalog.verbs.find((v) => v.id === action.slice("action.".length));
    if (!def) return 0;
    return Math.max(STAKES_RISK[def.stakes].risk, def.domain === "combat" ? COMBAT_SEEN_RISK : 0);
  };
}

/** Lo que teme de alguien que reconoce: el miedo de la relación y lo que le dolió con esa persona. */
function threatOfIn(w: LifeWorld): (who: AgentId) => number {
  const now = w.scheduler.now;
  const rels = w.truth.get(RELATIONS, w.player);
  const memories = w.truth.get(MEMORIES, w.player);
  const mind = w.truth.get(MIND, w.player);
  const ctx = {
    dims: w.relationDims,
    bonds: w.relationBonds,
    schemaStrength: (s: string) => mind?.schemas[s]?.strength ?? 0,
  };
  return (who) =>
    otherBeliefFrom({
      who,
      memories,
      now,
      relFear: relationship(rels, who, now, ctx).dims.fear,
      confidence: 1,
    }).threat;
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

export interface SeenFigure {
  readonly age?: AgeBand;
  readonly sex?: Sex;
  readonly attire?: string;
  readonly known: boolean;
}

function figureOf(p: Percept): SeenFigure {
  const fig = p.fields.figure?.value as { sex?: Sex; age?: AgeBand } | undefined;
  const attire = p.fields.attire?.value;
  return {
    ...(fig?.age === undefined ? {} : { age: fig.age }),
    ...(fig?.sex === undefined ? {} : { sex: fig.sex }),
    ...(typeof attire === "string" ? { attire } : {}),
    known: p.detail === "identified",
  };
}

/** Un edificio a la vista. */
export interface SeenBuilding {
  /** El tipo de `content/buildings` (cottage, farmhouse, granary…). */
  readonly type: string;
  /** El material que más se ve en las paredes y en el techo (`content/materials`). */
  readonly wall: string;
  readonly roof: string;
  /** 0 entero, 1 gastado, 2 muy gastado. */
  readonly worn: 0 | 1 | 2;
  readonly ruin: boolean;
  readonly burning: boolean;
  /** Metros al este (negativo, al oeste) de donde mira, y a cuántos está; redondeados a 5 m. */
  readonly x: number;
  readonly d: number;
}

/** Hasta cuántos metros ve un edificio según la luz, y cuántos pinta como mucho. */
export const BUILDING_SIGHT_M: Readonly<Record<Hud["light"], number>> = {
  bright: 250,
  dim: 100,
  dark: 30,
};
export const MAX_SEEN_BUILDINGS = 6;

/** El material con más gramos de una parte del edificio. */
function mainMaterial(b: BuildingRecord, part: "walls" | "roof"): string {
  let best = "";
  let grams = -1;
  for (const c of b.components)
    if (c.part === part)
      for (const m of c.materials)
        if (m.grams > grams || (m.grams === grams && m.material < best)) {
          best = m.material;
          grams = m.grams;
        }
  return best;
}

function wornOf(b: BuildingRecord): 0 | 1 | 2 {
  const visible = b.components.filter((c) => c.part === "walls" || c.part === "roof");
  const worst = Math.max(0, ...visible.map((c) => c.condition));
  return worst >= 0.6 ? 2 : worst >= 0.3 ? 1 : 0;
}

function lookOf(b: BuildingRecord): Omit<SeenBuilding, "x" | "d"> {
  return {
    type: b.type,
    wall: mainMaterial(b, "walls"),
    roof: mainMaterial(b, "roof"),
    worn: wornOf(b),
    ruin: b.ruin !== undefined,
    burning: (b.fire?.intensity ?? 0) > 0,
  };
}

const round5 = (m: number) => Math.round(m / 5) * 5;

/**
 * Los edificios a la vista desde `from` (metros respecto de la plaza): los que están a menos de
 * `sightM`, los `MAX_SEEN_BUILDINGS` más cercanos, de oeste a este. `except` es el propio (desde su
 * patio no se ve como uno más).
 */
export function seenBuildings(
  buildings: readonly { readonly id: string; readonly b: BuildingRecord }[],
  from: { readonly x: number; readonly y: number },
  sightM: number,
  except?: string,
): SeenBuilding[] {
  return buildings
    .filter((e) => e.id !== except)
    .map((e) => {
      const dx = e.b.at.x - from.x;
      const dy = e.b.at.y - from.y;
      return { e, dx, d: Math.hypot(dx, dy) };
    })
    .filter((s) => s.d <= sightM)
    .sort((a, b) => a.d - b.d || (a.e.id < b.e.id ? -1 : 1))
    .slice(0, MAX_SEEN_BUILDINGS)
    .sort((a, b) => a.dx - b.dx || (a.e.id < b.e.id ? -1 : 1))
    .map((s) => ({ ...lookOf(s.e.b), x: round5(s.dx), d: round5(s.d) }));
}

/** Los edificios de la vida que se ven (en pie, o caídos como ruina). */
function buildingRows(w: LifeWorld): { id: string; b: BuildingRecord }[] {
  const out: { id: string; b: BuildingRecord }[] = [];
  for (const id of [...w.truth.ids(BUILDING)].sort()) {
    const b = w.truth.get(BUILDING, id);
    if (!b) continue;
    if (w.truth.get(ENTITY, id)?.endedAt !== undefined && b.ruin === undefined) continue;
    out.push({ id, b });
  }
  return out;
}

/** Los edificios a la vista y en cuál está, para `Hud.place`. */
function buildingsOf(
  w: LifeWorld,
  space: string | undefined,
  indoor: boolean,
  light: Hud["light"],
): Pick<Hud["place"], "buildings" | "building"> {
  const rows = buildingRows(w);
  if (rows.length === 0 || space === undefined) return {};
  const mine = rows.find((r) => r.b.graph.spaces.some((s) => s.key === space));
  if (indoor) return mine ? { building: lookOf(mine.b) } : {};
  const from = mine?.b.at ?? { x: 0, y: 0 };
  return { buildings: seenBuildings(rows, from, BUILDING_SIGHT_M[light], mine?.id) };
}

/**
 * Un fuego que arde en el espacio donde está (con intensidad en el último paso); `undefined` si la
 * vida no simula fuegos.
 */
function fireIn(w: LifeWorld, space: string | undefined, indoor: boolean): boolean | undefined {
  const ids = w.truth.ids(HEARTH);
  if (ids.length === 0) return undefined;
  if (!indoor || space === undefined) return false;
  for (const id of ids) {
    const h = w.truth.get(HEARTH, id);
    if (h && h.space === space && h.intensity > 0) return true;
  }
  return false;
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
  const fire = fireIn(w, at?.space, indoor);
  const lightBand: Hud["light"] = light < 0.15 ? "dark" : light < 0.5 ? "dim" : "bright";
  const phase = dayPhase(hour);
  const look = skyLook(day.cloud, day.precip.kind, indoor);
  const moon = w.clock.moons.length > 0 ? moonAt(w.clock, skyObserverOf(w.map), 0, now) : null;
  return {
    hour,
    phase,
    light: lightBand,
    sky: look,
    windy: day.windMs >= (indoor ? 12 : 8),
    air: weather.airNow,
    season: weather.season,
    place: {
      indoor,
      home: character.where.home,
      space: node?.kind ?? "open",
      kinds: character.where.placeKinds as readonly PlaceKind[],
      ...(fire === undefined ? {} : { fire }),
      ...buildingsOf(w, at?.space, indoor, lightBand),
    },
    people: {
      around: seen.length,
      known: knownAround(w, seen),
      more: clear.length >= MAX_CLEAR_PERCEPTS,
      figures: seen.map(figureOf),
    },
    body: bodyOf(character.body),
    coins,
    mood: moodOf(w, character),
    warmth: warmthOf(w.truth.get(THERMAL, w.player)?.coreC),
    ...nightSky({ indoor, sky: look, phase }, moon),
    danger: dangerOf(seen, threatOfIn(w), riskOfIn(w)),
    load: loadOf(w),
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
