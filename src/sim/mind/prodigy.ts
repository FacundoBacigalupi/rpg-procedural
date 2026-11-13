// Prodigios que se cuentan (novel2-trib-far-gossip, information §2): «cayeron rayos del cielo por el
// lado del monte». No es un hecho con autor y víctima (eso es `law/rumor`): es algo que se vio en el
// cielo, sin quién, y la fuente es la memoria de quien lo vio. Contarlo deja en el oyente una memoria
// `told` del mismo evento, con menos confianza (la de quien cuenta por cuánto le cree) y menos fuerza;
// esa memoria se puede volver a contar, así que el relato se apaga solo con cada boca y con los días.
// Qué clases de memoria son prodigio lo decide quien llama. Constantes sin calibrar.
//
// Puro: lee memorias y devuelve el relato, las ganas de contarlo y lo que guarda el oyente.

import { type AgentId, type EventId, type PlaceRef, pow, type Tick } from "../../core/index.ts";
import type { Experience, Memories, Memory } from "./memory.ts";

const DAY = 86_400;
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const round = (x: number): number => Math.round(x * 1e6) / 1e6;

/** Días para que las ganas de contar un prodigio bajen a la mitad (la novedad se gasta rápido). */
export const PRODIGY_HALF_DAYS = 3;
/** Cuánto de la fuerza de la memoria pasa al oyente al contarlo. */
export const PRODIGY_TOLD_DAMP = 0.7;
/** Cuánto más ganas da lo asombroso frente a un chisme cualquiera (un prodigio es noticia). */
export const PRODIGY_GAIN = 3;
/** Lo que se oyó se cuenta con menos ganas que lo visto. */
export const PRODIGY_HEARSAY = 0.85;
/** Bajo esta confianza no se cuenta (ya no lo cree lo bastante para decirlo). */
export const PRODIGY_MIN_CONFIDENCE = 0.1;

/** Un prodigio que alguien puede contar, sacado de su memoria. */
export interface ProdigyTale {
  /** El evento real (la causa de la contada). */
  readonly root: EventId;
  readonly kind: string;
  /** Dónde lo ubica quien lo cuenta. */
  readonly place: PlaceRef;
  /** Cuándo pasó, según su memoria. */
  readonly at: Tick;
  readonly intensity: number;
  readonly valence: number;
  /** 0-1: cuánto lo cree. */
  readonly confidence: number;
  /** Lo vio él (o se lo contaron). */
  readonly seen: boolean;
  /** Quién se lo contó, si no lo vio. */
  readonly toldBy?: AgentId;
}

/** Los prodigios que `memories` guarda y todavía cree, uno por evento, el más fuerte primero. */
export function prodigyTales(
  memories: Memories | undefined,
  isProdigy: (kind: string) => boolean,
): ProdigyTale[] {
  const byRoot = new Map<EventId, Memory>();
  for (const m of memories?.items ?? []) {
    if (!isProdigy(m.perceived.kind) || m.confidence < PRODIGY_MIN_CONFIDENCE) continue;
    const prev = byRoot.get(m.eventId);
    if (!prev || m.confidence > prev.confidence) byRoot.set(m.eventId, m);
  }
  return [...byRoot.values()]
    .map((m) => ({
      root: m.eventId,
      kind: m.perceived.kind,
      place: m.perceived.place,
      at: m.at,
      intensity: m.intensity,
      valence: m.valence,
      confidence: m.confidence,
      seen: m.source === "witnessed",
      ...(m.toldBy === undefined ? {} : { toldBy: m.toldBy }),
    }))
    .sort(
      (a, b) =>
        b.intensity * b.confidence - a.intensity * a.confidence || (a.root < b.root ? -1 : 1),
    );
}

/** Si `memories` ya tiene algo de ese evento (lo vio o se lo contaron). */
export const knowsOf = (memories: Memories | undefined, root: EventId): boolean =>
  memories?.items.some((m) => m.eventId === root) === true;

export interface ProdigyDesireInput {
  readonly tale: ProdigyTale;
  readonly now: Tick;
  /** 0-1: ganas de charlar. */
  readonly sociability: number;
  /** -1..1: cuánto le cree al que escucha (con quien no se tiene trato se habla menos). */
  readonly trustInListener: number;
  /** El oyente ya lo sabe (según el que cuenta). */
  readonly listenerKnows: boolean;
}

/**
 * Las ganas de contar un prodigio (0-1): lo fuerte que fue, por cuánto lo cree, con la novedad que
 * cae a la mitad cada `PRODIGY_HALF_DAYS`, por la sociabilidad y un poco por la confianza en el
 * oyente. Lo visto con los propios ojos se cuenta con más ganas. Con el piso de contar del chisme,
 * lo visto de cerca llega a dos o tres bocas antes de apagarse.
 */
export function prodigyDesire(x: ProdigyDesireInput): number {
  if (x.listenerKnows || x.tale.confidence < PRODIGY_MIN_CONFIDENCE) return 0;
  const age = Math.max(0, (x.now - x.tale.at) / DAY);
  const novelty = pow(0.5, age / PRODIGY_HALF_DAYS);
  const firstHand = x.tale.seen ? 1 : PRODIGY_HEARSAY;
  const belief = 0.5 + 0.5 * x.tale.confidence;
  const chatty = 0.5 + 0.5 * clamp01(x.sociability);
  const trust = 0.7 + 0.3 * clamp01((x.trustInListener + 1) / 2);
  return round(
    clamp01(PRODIGY_GAIN * x.tale.intensity * belief * novelty * firstHand * chatty * trust),
  );
}

/**
 * Lo que guarda el oyente: el mismo evento, contado por `teller`, con la claridad de lo que cree
 * quien cuenta por cuánto le cree el oyente (`trust` -1..1) y la fuerza amortiguada.
 */
export function heardProdigy(
  tale: ProdigyTale,
  teller: AgentId,
  trust: number,
  encoding = 1,
): Experience {
  return {
    eventId: tale.root,
    kind: tale.kind,
    with: [],
    place: tale.place,
    at: tale.at,
    intensity: round(tale.intensity * PRODIGY_TOLD_DAMP),
    valence: round(tale.valence * PRODIGY_TOLD_DAMP),
    source: "told",
    toldBy: teller,
    clarity: round(clamp01(tale.confidence * (0.6 + 0.4 * trust))),
    encoding,
  };
}
