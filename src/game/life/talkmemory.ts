// La charla y la memoria (dialogue §5, npc-psychology §5): conversar refuerza lo que el oyente
// recordó al contestar (`recall`), y si le preguntan por alguien cuenta o niega lo que recuerda de
// esa persona. Lo contado deja en quien preguntó una memoria `told` (confianza de segunda mano).
// Todo puro: `life.converse` lo arma y deja el resultado en el efecto del `action.speak`;
// `life.appraise` es el único que escribe `MEMORIES` (así no se pisan en la fase).

import type { AgentId, Event, EventId, PlaceRef, Tick } from "../../core/index.ts";
import {
  addMemory,
  formMemory,
  type Memories,
  type Memory,
  memoriesAbout,
  recall,
} from "../../sim/index.ts";

/** Cuántas memorias de quien habla pesan en la respuesta (y se refuerzan al contestar). */
export const WEIGHED_MEMORIES = 2;
/** Saliencia mínima para que una memoria pese en lo que se contesta. */
export const WEIGH_FROM = 0.1;
/** Valencia desde la que lo recordado se cuenta como grato o amargo. */
export const RECOUNT_TONE = 0.25;
/** Cuánto de la intensidad de lo contado le queda a quien lo escucha de segunda mano. */
export const TOLD_INTENSITY = 0.5;
/** Tope de la intensidad de una memoria contada. */
export const TOLD_INTENSITY_CAP = 0.5;
/** Valencia desde la que doler tanto hace callar al poco honesto. */
export const PAINFUL = -0.4;
/** Honestidad bajo la cual lo doloroso se niega. */
export const HONEST_ENOUGH = 0.5;

const round = (x: number) => Math.round(x * 1e6) / 1e6;

/** Las memorias de `speaker` que pesaron al contestarle: las más salientes, ya vivas. */
export function weighedMemories(
  memories: Memories | undefined,
  speaker: AgentId,
  now: Tick,
): EventId[] {
  return memoriesAbout(memories, speaker, now)
    .filter((s) => s.salience >= WEIGH_FROM)
    .slice(0, WEIGHED_MEMORIES)
    .map((s) => s.memory.eventId);
}

/** Lo que el oyente recuerda de `about` y qué hace con eso cuando le preguntan. */
export interface Recount {
  readonly event: EventId;
  readonly kind: string;
  readonly with: readonly AgentId[];
  readonly valence: number;
  readonly intensity: number;
  /** Lo calla o lo niega (rencor hacia quien pregunta, o algo doloroso y poca honestidad). */
  readonly denied: boolean;
}

/**
 * Lo que el oyente recuerda de `about` (su memoria más saliente que lo incluye) y si lo cuenta:
 * lo niega quien guarda rencor o desconfía de quien pregunta (`grudge`), y quien tiene poca
 * honestidad lo doloroso. Sin memoria de esa persona, nada.
 */
export function recountOf(
  memories: Memories | undefined,
  about: AgentId,
  now: Tick,
  who: { readonly honesty: number; readonly grudge: boolean },
): Recount | null {
  const top = memoriesAbout(memories, about, now)[0];
  if (!top || top.salience < WEIGH_FROM) return null;
  const m = top.memory;
  const denied = who.grudge || (m.valence <= PAINFUL && who.honesty < HONEST_ENOUGH);
  return {
    event: m.eventId,
    kind: m.perceived.kind,
    with: m.perceived.with,
    valence: m.valence,
    intensity: m.intensity,
    denied,
  };
}

/** El tono con que se cuenta: la línea `ask.recalled.<tono>`. */
export function recountTone(valence: number): "good" | "bad" | "plain" {
  if (valence >= RECOUNT_TONE) return "good";
  if (valence <= -RECOUNT_TONE) return "bad";
  return "plain";
}

/** Refuerza (`recall`) las memorias citadas por `events`, sin tocar el resto. */
export function recallEvents(
  memories: Memories | undefined,
  events: readonly string[],
  now: Tick,
): Memories | undefined {
  if (!memories || events.length === 0) return memories;
  let touched = false;
  const items = memories.items.map((m) => {
    if (!events.includes(m.eventId)) return m;
    touched = true;
    return recall(m, now);
  });
  return touched ? { ...memories, items } : memories;
}

/**
 * La memoria que le queda a quien preguntó de lo que le contaron: de segunda mano
 * (`told`, confianza 0,55), menos intensa y con el relator como fuente.
 */
export function toldMemory(r: Recount, teller: AgentId, place: PlaceRef, at: Tick): Memory {
  return formMemory({
    eventId: r.event,
    kind: r.kind,
    with: r.with,
    place,
    at,
    intensity: Math.min(TOLD_INTENSITY_CAP, round(r.intensity * TOLD_INTENSITY)),
    valence: r.valence,
    source: "told",
    toldBy: teller,
  });
}

/** Lo que `life.converse` deja en el efecto del `action.speak` sobre la memoria. */
export interface TalkMemory {
  /** Eventos de las memorias del oyente que pesaron y se refuerzan. */
  readonly recalled?: readonly string[];
  /** Lo que contó (o negó) si le preguntaron por alguien. */
  readonly recounted?: Recount;
}

/** Lee `TalkMemory` del efecto de un `action.speak`. */
export function talkMemoryIn(e: Event): TalkMemory | null {
  const eff = (e.data as { effect?: { kind?: string } & TalkMemory } | null)?.effect;
  if (eff?.kind !== "speak") return null;
  if (!eff.recalled && !eff.recounted) return null;
  return {
    ...(eff.recalled ? { recalled: eff.recalled } : {}),
    ...(eff.recounted ? { recounted: eff.recounted } : {}),
  };
}

/**
 * Aplica la charla a las memorias: el oyente refuerza las que pesaron y las que contó; quien
 * preguntó guarda, si no la tenía, la memoria contada (si se negó, nada).
 */
export function applyTalkMemory(
  listener: Memories | undefined,
  asker: Memories | undefined,
  talk: TalkMemory,
  ctx: { readonly teller: AgentId; readonly place: PlaceRef; readonly now: Tick },
): { listener: Memories | undefined; asker: Memories | undefined } {
  const recalled = [...(talk.recalled ?? []), ...(talk.recounted ? [talk.recounted.event] : [])];
  const mine = recallEvents(listener, recalled, ctx.now);
  const r = talk.recounted;
  if (!r || r.denied || asker?.items.some((m) => m.eventId === r.event)) {
    return { listener: mine, asker };
  }
  return {
    listener: mine,
    asker: addMemory(asker, toldMemory(r, ctx.teller, ctx.place, ctx.now), ctx.now),
  };
}
