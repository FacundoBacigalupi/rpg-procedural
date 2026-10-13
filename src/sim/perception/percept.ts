// Percepción (perception.md, Fase 1): la única puerta entre la verdad y lo que alguien sabe.
// Un estímulo (una persona que está, un paso que alguien hizo) emite por vista y oído; lo que
// llega a cada observador depende del camino por el grafo de espacios (paredes, puertas,
// vegetación), la distancia, la luz donde está la fuente, el ruido de fondo donde está el que
// escucha, sus sentidos y su atención. Cada dato del estímulo (que hay alguien, qué figura, quién
// es, qué hace, qué dice) se lee o no por separado, con una tirada contra su legibilidad: así
// salen solos los grados ("algo se movió", "un muchacho", "tu tío Wen").
//
// Puro y determinista: cada observador tira con `fork("perception", fuente, tick, observador)`.
// Los errores con forma (completar con lo que se espera ver), la atención por saliencia y las
// huellas llegan en la Fase 2 (perception §Implementación).

import {
  type AgentId,
  type EntityRef,
  type EventId,
  exp,
  log,
  logistic,
  type Rng,
  type Tick,
} from "../../core/index.ts";
import {
  type Location,
  openSpaceKey,
  type SpaceGraph,
  type SpaceNode,
  spaceLight,
  spaceReach,
  withOpenSpaces,
} from "../world/index.ts";

/** Los canales de la Fase 1. Olfato, tacto, gusto, esencia y alma llegan con sus fases. */
export const CHANNELS = ["sight", "sound"] as const;
export type Channel = (typeof CHANNELS)[number];

/** Los datos que se pueden leer de un estímulo. */
export const PERCEPT_KEYS = [
  "presence",
  "figure",
  "attire",
  "identity",
  "action",
  "words",
] as const;
export type PerceptKey = (typeof PERCEPT_KEYS)[number];

/**
 * Cuánto se supo: `vague` (algo, alguien, un ruido), `clear` (se vio bien, pero no se reconoce a
 * nadie: un desconocido, o qué hace sin saber quién), `identified` (se reconoció a quién).
 */
export type PerceptDetail = "vague" | "clear" | "identified";

export interface PerceptField {
  readonly value: unknown;
  /** 0-1: cuán seguro está el observador de lo que leyó. */
  readonly confidence: number;
  /** Verdad del mundo: solo para el inspector y la crónica (siempre false hasta la Fase 2). */
  readonly mistaken: boolean;
}

/** Id de un percept: la fuente, el tick y el observador (no es una entidad con contador). */
export type PerceptId = string;

export interface Percept {
  readonly id: PerceptId;
  readonly observer: AgentId;
  readonly sourceEventId?: EventId;
  readonly sourceEntityId?: EntityRef;
  readonly tick: Tick;
  /** Por dónde llegó lo que se leyó, en el orden de `CHANNELS`. */
  readonly channels: readonly Channel[];
  readonly detail: PerceptDetail;
  readonly fields: Readonly<Partial<Record<PerceptKey, PerceptField>>>;
}

/** Lo que un atributo emite por un canal: cuánta señal y cuánta hace falta para leerlo. */
export interface ChannelSignal {
  readonly intensity: number;
  readonly legibility: number;
}

export interface AttrEmission {
  readonly key: PerceptKey;
  /** El valor real. */
  readonly value: unknown;
  readonly signal: Readonly<Partial<Record<Channel, ChannelSignal>>>;
  /**
   * Reconocer a alguien: la legibilidad se divide por cuánto lo conoce el observador. Sin
   * conocerlo, leerlo da `null` (una cara que no conoce).
   */
  readonly personal?: EntityRef;
  /** Solo se lee si antes se leyó este otro dato (para mirar a alguien hay que notarlo). */
  readonly requires?: PerceptKey;
}

export interface Stimulus {
  readonly source: { readonly event: EventId } | { readonly entity: EntityRef };
  readonly tick: Tick;
  readonly at: Location;
  readonly attributes: readonly AttrEmission[];
  /** Quienes no lo perciben como algo de afuera (el que actúa se entera por su autopercepción). */
  readonly exclude?: readonly EntityRef[];
}

/** Los sentidos de alguien (perception §4): agudeza por canal y atención, más a quién conoce. */
export interface Observer {
  readonly id: AgentId;
  readonly at: Location;
  readonly acuity: Readonly<Record<Channel, number>>;
  /** Multiplica la señal: dormido casi nada, mirando con atención más que uno. */
  readonly attention: number;
  /** Cuánto conoce a cada uno, 0-1 (la familia 1, un vecino de vista ~0,4); el resto, 0. */
  readonly familiar: ReadonlyMap<EntityRef, number>;
}

/** El entorno de la escena: el grafo del sitio, el bosque del parche y la luz del día. */
export interface Medium {
  readonly graph: SpaceGraph;
  /** Por hex del parche local (`LocalMap.forest`). */
  readonly forest: readonly boolean[];
  /** Luz del día afuera, 0-1 (`daylight(localHour(...))`). */
  readonly daylight: number;
}

// ---------------------------------------------------------------------------------------------
// Calibración (perception §Decisiones 2026-10-05; abierta a la sim headless). Con estas curvas: a
// 30 pasos (22 m) a plena luz se reconoce a un conocido el ~95% de las veces y de noche sin luna
// el ~5%; una charla normal se entiende a 15 m en una plaza tranquila y a 30 m, a medias.

/** Cuán abrupto pasa la lectura de imposible a segura con el cociente señal / legibilidad. */
export const READ_SLOPE = 2;
/** Distancia (m) a la que la señal cae a la mitad, por canal: 1 / (1 + (d/D)²). */
export const FALLOFF_METERS: Readonly<Record<Channel, number>> = { sight: 20, sound: 15 };
/** El ruido nunca es cero: el oído también tiene su piso. */
export const NOISE_FLOOR = 0.01;

/** La atención por estado (perception §4). Mirar con cuidado suma la agudeza de `observe`. */
export const ATTENTION = {
  asleep: 0.03,
  absorbed: 0.5,
  relaxed: 0.8,
  alert: 1,
} as const;

/** La atención de quien mira a propósito, con la agudeza 0-1 de su `observe`. */
export function watching(acuity: number): number {
  return ATTENTION.alert * (1 + Math.max(0, Math.min(1, acuity)));
}

/**
 * Los sentidos por edad y aptitud (perception §4): de chico se ve algo menos, la vista baja
 * desde los 45 y el oído desde los 50; la aptitud `perception` (en desvíos) multiplica todo. Las
 * secuelas del cuerpo llegan con body-health §3.
 */
export function sensorAcuity(ageYears: number, perceptionZ = 0): Record<Channel, number> {
  const young = ageYears < 3 ? 0.6 : ageYears < 8 ? 0.85 : 1;
  const sight = young * Math.max(0.3, 1 - 0.015 * Math.max(0, ageYears - 45));
  const sound = young * Math.max(0.3, 1 - 0.012 * Math.max(0, ageYears - 50));
  const k = exp(0.25 * perceptionZ);
  return { sight: sight * k, sound: sound * k };
}

/** Cuánto llega por un canal a esa distancia, antes de barreras, luz y ruido. */
export function falloff(channel: Channel, meters: number): number {
  const r = meters / FALLOFF_METERS[channel];
  return 1 / (1 + r * r);
}

/** La probabilidad de leer un dato con este cociente señal / legibilidad. */
export function readChance(ratio: number): number {
  return ratio <= 0 ? 0 : logistic(READ_SLOPE * log(ratio));
}

// ---------------------------------------------------------------------------------------------
// Detección

/** Lo que llega de la fuente al observador por cada canal: ganancia por unidad de intensidad. */
export type ChannelGain = Readonly<Record<Channel, number>>;

/** La ganancia de cada canal entre una fuente y un observador (§3, §5: señal × agudeza / ruido). */
export function channelGain(medium: Medium, observer: Observer, source: Location): ChannelGain {
  const graph = mediumGraph(medium, [observer.at, source]);
  const from = spaceOf(observer.at);
  const to = spaceOf(source);
  const nodes = new Map(graph.spaces.map((s) => [s.key, s]));
  const here = nodes.get(from) as SpaceNode;
  const there = nodes.get(to) as SpaceNode;
  const out: Record<Channel, number> = { sight: 0, sound: 0 };
  for (const channel of CHANNELS) {
    const reach = spaceReach(graph, from, to, channel);
    if (reach.pass <= 0) continue;
    const condition = channel === "sight" ? spaceLight(there, medium.daylight) : 1;
    const noise = channel === "sight" ? 1 : Math.max(NOISE_FLOOR, here.noise);
    out[channel] =
      (falloff(channel, reach.meters) *
        reach.pass *
        condition *
        observer.acuity[channel] *
        observer.attention) /
      noise;
  }
  return out;
}

/** Lo que perciben los observadores de un estímulo: un percept por quien leyó algo. */
export function perceive(
  stimulus: Stimulus,
  observers: readonly Observer[],
  medium: Medium,
  rng: Rng,
): Percept[] {
  const sourceId = "event" in stimulus.source ? stimulus.source.event : stimulus.source.entity;
  const excluded = new Set(stimulus.exclude ?? []);
  const out: Percept[] = [];
  for (const observer of [...observers].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (excluded.has(observer.id)) continue;
    if (observer.at.hex !== stimulus.at.hex) continue; // fuera de alcance en la Fase 1 (§12)
    const gain = channelGain(medium, observer, stimulus.at);
    const r = rng.fork("perception", sourceId, stimulus.tick, observer.id);
    const fields: Partial<Record<PerceptKey, PerceptField>> = {};
    const used = new Set<Channel>();
    for (const attr of stimulus.attributes) {
      const roll = r.float(); // siempre se tira: el flujo no depende de lo que se leyó antes
      if (attr.requires !== undefined && fields[attr.requires] === undefined) continue;
      const familiarity =
        attr.personal === undefined ? 1 : (observer.familiar.get(attr.personal) ?? 0);
      // Sin conocerlo se lee igual de bien que se vería a un conocido, pero no se lo reconoce.
      const scale = attr.personal === undefined || familiarity <= 0 ? 1 : familiarity;
      let ratio = 0;
      const contributes: Channel[] = [];
      for (const channel of CHANNELS) {
        const s = attr.signal[channel];
        if (!s || gain[channel] <= 0 || s.intensity <= 0) continue;
        ratio += (s.intensity * gain[channel] * scale) / s.legibility;
        contributes.push(channel);
      }
      const p = readChance(ratio);
      if (roll >= p) continue;
      for (const c of contributes) used.add(c);
      fields[attr.key] = {
        value: attr.personal !== undefined && familiarity <= 0 ? null : attr.value,
        confidence: p,
        mistaken: false,
      };
    }
    if (Object.keys(fields).length === 0) continue;
    const identity = fields.identity;
    const detail: PerceptDetail =
      identity !== undefined && identity.value !== null
        ? "identified"
        : identity !== undefined || fields.figure !== undefined || fields.words !== undefined
          ? "clear"
          : "vague";
    out.push({
      id: `${sourceId}@${stimulus.tick}/${observer.id}`,
      observer: observer.id,
      ...("event" in stimulus.source
        ? { sourceEventId: stimulus.source.event }
        : { sourceEntityId: stimulus.source.entity }),
      tick: stimulus.tick,
      channels: CHANNELS.filter((c) => used.has(c)),
      detail,
      fields: orderedFields(fields),
    });
  }
  return out;
}

function orderedFields(
  fields: Partial<Record<PerceptKey, PerceptField>>,
): Partial<Record<PerceptKey, PerceptField>> {
  const out: Partial<Record<PerceptKey, PerceptField>> = {};
  for (const k of PERCEPT_KEYS) {
    const f = fields[k];
    if (f !== undefined) out[k] = f;
  }
  return out;
}

function spaceOf(at: Location): string {
  return at.space ?? openSpaceKey(at.hex);
}

/** El grafo con el campo abierto de los hexes donde hay alguien sin espacio. */
function mediumGraph(medium: Medium, at: readonly Location[]): SpaceGraph {
  const open = at
    .filter((l) => l.space === undefined)
    .map((l) => ({ hex: l.hex, forest: medium.forest[l.hex] ?? false }));
  return open.length === 0 ? medium.graph : withOpenSpaces(medium.graph, open);
}
