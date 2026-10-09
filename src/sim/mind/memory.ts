// Memoria episódica (npc-psychology §5, Fase 2): lo que alguien vivió, guardado como lo vivió. Cada
// memoria cita el evento real (la verdad, para el inspector) y trae lo que la persona cree que pasó,
// con intensidad emocional, valencia, confianza y saliencia. La saliencia decae con una vida media
// que crece mucho con la intensidad (las memorias «flash» casi no se van); recordar la refuerza. Lo
// que cae bajo `FORGET_BELOW`, o no cabe en la capacidad, no desaparece sin rastro: se comprime en un
// resumen (gist) que cuenta cuántas veces y con quién, y que guarda las causas.
//
// El decaimiento es perezoso (se calcula al leer, como las relaciones y los hábitos). Todavía no hay
// distorsión al recordar ni memorias contadas por otros: `distortion` y `source` ya están en el tipo
// para cuando lleguen (información, diálogo).

import {
  type AgentId,
  compareStrings,
  type EventId,
  exp,
  LN2,
  type PlaceRef,
  type Tick,
} from "../../core/index.ts";
import { table } from "../world/index.ts";

const DAY = 86_400;

export type MemorySource = "witnessed" | "told" | "inferred";

/** Lo que la persona cree que pasó (puede diferir de la verdad cuando haya distorsión). */
export interface PerceivedEvent {
  /** El tipo del evento (`combat.fight`, `action.give`, `body.died`…). */
  readonly kind: string;
  /** Con quién, según ella. */
  readonly with: readonly AgentId[];
  readonly place: PlaceRef;
}

export interface Memory {
  /** El evento real, para el inspector y las causas. */
  readonly eventId: EventId;
  readonly perceived: PerceivedEvent;
  readonly source: MemorySource;
  readonly toldBy?: AgentId;
  /** Cuándo pasó. */
  readonly at: Tick;
  /** 0-1: peso emocional al formarse. */
  readonly intensity: number;
  /** -1..1: cuánto dolió o agradó. */
  readonly valence: number;
  /** 0-1: cuánto cree que fue así. */
  readonly confidence: number;
  /** 0-1: cuánto se alejó `perceived` del original (0 hasta que haya distorsión). */
  readonly distortion: number;
  /** 0-1 medida en `measured`; después decae. */
  readonly salience: number;
  readonly measured: Tick;
  readonly lastRecalled: Tick;
  readonly recalls: number;
}

/** Lo que queda de lo olvidado: «me pegaron tres veces los Zhao». */
export interface Gist {
  readonly kind: string;
  readonly with: readonly AgentId[];
  /** Cuántas memorias se comprimieron acá. */
  readonly count: number;
  /** Promedio de la valencia, ponderado por intensidad. */
  readonly valence: number;
  /** La mayor intensidad que tuvo. */
  readonly peak: number;
  readonly first: Tick;
  readonly last: Tick;
  readonly causes: readonly EventId[];
}

export interface Memories {
  readonly items: readonly Memory[];
  readonly gists: readonly Gist[];
}

export const MEMORIES = table<Memories>("mind.memories");

/** Días de mundo para que la saliencia de una memoria sin carga emocional baje a la mitad. */
export const BASE_HALF_LIFE_DAYS = 30;
/** Cuánto alarga la vida media la intensidad (`1 + FLASH_SCALE × intensidad⁴`): 0,9 → ~×40. */
export const FLASH_SCALE = 60;
/** Cuánto sube la saliencia al recordar (fracción del hueco hasta 1). */
export const RECALL_GAIN = 0.4;
/** Bajo esta saliencia la memoria se comprime a gist. */
export const FORGET_BELOW = 0.05;
/** Memorias episódicas por persona (npc-psychology §Tiers: 20, a ajustar con la sim headless). */
export const MEMORY_CAPACITY = 20;
export const MAX_GISTS = 40;
export const MAX_GIST_CAUSES = 4;
/** Confianza de partida según cómo se supo. */
export const SOURCE_CONFIDENCE: Readonly<Record<MemorySource, number>> = {
  witnessed: 0.95,
  told: 0.55,
  inferred: 0.4,
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const round = (x: number) => Math.round(x * 1e6) / 1e6;

/** Vida media (días) de la saliencia: crece con la intensidad hasta casi no decaer. */
export function halfLifeDays(intensity: number): number {
  const i = clamp01(intensity);
  return BASE_HALF_LIFE_DAYS * (1 + FLASH_SCALE * i * i * i * i);
}

/** La saliencia de `m` al momento `now`, ya decaída. */
export function salienceAt(m: Memory, now: Tick): number {
  const elapsed = Math.max(0, now - m.measured);
  return round(m.salience * exp((-LN2 * elapsed) / (halfLifeDays(m.intensity) * DAY)));
}

export interface Experience {
  readonly eventId: EventId;
  readonly kind: string;
  readonly with: readonly AgentId[];
  readonly place: PlaceRef;
  readonly at: Tick;
  readonly intensity: number;
  readonly valence: number;
  readonly source?: MemorySource;
  readonly toldBy?: AgentId;
  /** 0-1: qué tan bien lo percibió (luz, distancia, atención); multiplica la confianza. */
  readonly clarity?: number;
  /** 0-1: qué tan bien guarda memorias nuevas (cognición, sueño, edad); multiplica la saliencia. */
  readonly encoding?: number;
}

/** Una memoria nueva con lo vivido: arranca con la saliencia de su intensidad. */
export function formMemory(x: Experience): Memory {
  const source = x.source ?? "witnessed";
  const intensity = clamp01(x.intensity);
  return {
    eventId: x.eventId,
    perceived: { kind: x.kind, with: [...x.with], place: x.place },
    source,
    ...(x.toldBy === undefined ? {} : { toldBy: x.toldBy }),
    at: x.at,
    intensity: round(intensity),
    valence: round(Math.min(1, Math.max(-1, x.valence))),
    confidence: round(SOURCE_CONFIDENCE[source] * clamp01(x.clarity ?? 1)),
    distortion: 0,
    salience: round(clamp01(0.3 + 0.7 * intensity) * clamp01(x.encoding ?? 1)),
    measured: x.at,
    lastRecalled: x.at,
    recalls: 0,
  };
}

/** Recordar (pensarla, contarla, ver algo que la evoca) la refuerza desde su saliencia actual. */
export function recall(m: Memory, now: Tick): Memory {
  const s = salienceAt(m, now);
  return {
    ...m,
    salience: round(s + RECALL_GAIN * (1 - s)),
    measured: now,
    lastRecalled: now,
    recalls: m.recalls + 1,
  };
}

const gistKey = (kind: string, others: readonly AgentId[]) =>
  `${kind}|${[...others].sort(compareStrings).join(",")}`;

/** Comprime memorias en gists: cada (tipo, con quién) suma al resumen que ya hubiera. */
export function compress(gists: readonly Gist[], dropped: readonly Memory[]): Gist[] {
  const byKey = new Map<string, Gist>(gists.map((g) => [gistKey(g.kind, g.with), g]));
  for (const m of [...dropped].sort((a, b) => a.at - b.at)) {
    const key = gistKey(m.perceived.kind, m.perceived.with);
    const g = byKey.get(key);
    const w = Math.max(m.intensity, 0.01);
    if (!g) {
      byKey.set(key, {
        kind: m.perceived.kind,
        with: [...m.perceived.with].sort(compareStrings),
        count: 1,
        valence: m.valence,
        peak: m.intensity,
        first: m.at,
        last: m.at,
        causes: [m.eventId],
      });
      continue;
    }
    const gw = Math.max(g.peak, 0.01) * g.count;
    byKey.set(key, {
      ...g,
      count: g.count + 1,
      valence: round((g.valence * gw + m.valence * w) / (gw + w)),
      peak: Math.max(g.peak, m.intensity),
      first: Math.min(g.first, m.at),
      last: Math.max(g.last, m.at),
      causes: [...g.causes, m.eventId].slice(-MAX_GIST_CAUSES),
    });
  }
  // Si hay demasiados resúmenes, se olvidan los más viejos y menos intensos.
  return [...byKey.values()]
    .sort((a, b) => b.peak * b.count - a.peak * a.count || b.last - a.last)
    .slice(0, MAX_GISTS)
    .sort((a, b) => a.first - b.first || compareStrings(a.kind, b.kind));
}

/**
 * Suma una memoria y deja la casa en orden: lo que ya está bajo `FORGET_BELOW`, o sobra de la
 * capacidad (se queda con las de más saliencia), pasa a gist. Las memorias quedan por `at`.
 */
export function addMemory(
  memories: Memories | undefined,
  m: Memory,
  now: Tick,
  capacity: number = MEMORY_CAPACITY,
): Memories {
  const all = [...(memories?.items ?? []), m];
  const scored = all.map((x) => ({ x, s: salienceAt(x, now) }));
  const keep: typeof scored = [];
  const drop: Memory[] = [];
  for (const e of scored) {
    if (e.s >= FORGET_BELOW) keep.push(e);
    else drop.push(e.x);
  }
  const ranked = keep.sort(
    (a, b) => b.s - a.s || b.x.at - a.x.at || compareStrings(a.x.eventId, b.x.eventId),
  );
  for (const e of ranked.slice(capacity)) drop.push(e.x);
  const items = ranked
    .slice(0, capacity)
    .map((e) => e.x)
    .sort((a, b) => a.at - b.at || compareStrings(a.eventId, b.eventId));
  return {
    items,
    gists: drop.length === 0 ? [...(memories?.gists ?? [])] : compress(memories?.gists ?? [], drop),
  };
}

/** Las memorias vivas de alguien al momento `now`, de la más a la menos saliente. */
export function salient(
  memories: Memories | undefined,
  now: Tick,
): { readonly memory: Memory; readonly salience: number }[] {
  return (memories?.items ?? [])
    .map((memory) => ({ memory, salience: salienceAt(memory, now) }))
    .sort((a, b) => b.salience - a.salience || compareStrings(a.memory.eventId, b.memory.eventId));
}

/** Las memorias de `who` (con quién fue), de la más a la menos saliente. */
export function memoriesAbout(
  memories: Memories | undefined,
  who: AgentId,
  now: Tick,
): { readonly memory: Memory; readonly salience: number }[] {
  return salient(memories, now).filter((s) => s.memory.perceived.with.includes(who));
}
