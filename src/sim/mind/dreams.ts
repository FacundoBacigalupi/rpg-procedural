// Sueños con contenido (npc-psychology §15, Fase 3). Una noche de sueño que consolidó arma, con lo
// que la mente ya tiene, un `Dream`: sus fuentes son memorias recientes o intensas (y las que
// disparan una pesadilla), el tono sale de su valencia e intensidad, y los símbolos son la
// traducción de los temas de esas memorias. Un sueño NO trae información nueva: todo lo que
// contiene viene de `Memory`, y por eso cada fuente es un `EventId` real (causas del evento).
//
// Puro: `composeDream` no escribe nada. El vocabulario de símbolos es genérico (por tema); el de
// cada cultura y la interpretación quedan en el ROADMAP (`psy-dreams-culture`).

import type { AgentId, EventId, Rng, Tick } from "../../core/index.ts";
import { type Memory, salienceAt } from "./memory.ts";
import type { Theme } from "./mind.ts";

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const round = (x: number) => Math.round(x * 1e6) / 1e6;
const DAY = 86_400;

/** Cuántas memorias alimentan un sueño como mucho. */
export const MAX_DREAM_SOURCES = 3;
/** Una memoria es «del día» hasta esta antigüedad (días). */
export const RECENT_DAYS = 3;
/** O es lo bastante intensa para volver a cualquier edad. */
export const INTENSE_FROM = 0.5;
/** Bajo esta calidad de sueño no se sueña con orden (el sueño es fragmento): no hay sueño. */
export const DREAM_MIN_QUALITY = 0.15;
/** Cuántos símbolos como mucho trae un sueño. */
export const MAX_SYMBOLS = 3;

/** Símbolo genérico por tema (ids estables; el texto lo pone la cultura/narrador). */
export const THEME_SYMBOLS: Readonly<Record<Theme, readonly string[]>> = {
  care: ["hearth", "warm-water"],
  neglect: ["empty-house", "closed-door"],
  violence: ["blade", "red-water"],
  loss: ["empty-seat", "fading-voice"],
  hardship: ["steep-road", "heavy-load"],
  plenty: ["full-granary", "ripe-field"],
  betrayal: ["broken-seal", "turned-back"],
  kindness: ["open-hand", "shared-bowl"],
  success: ["summit", "lit-lamp"],
  failure: ["fallen-bridge", "dry-well"],
  injustice: ["crooked-scale", "silent-crowd"],
  calamity: ["flood", "burning-roof"],
  blessing: ["clear-sky", "first-rain"],
  guilt: ["stained-hands", "following-shadow"],
};

export interface Dream {
  readonly dreamer: AgentId;
  readonly night: number;
  /** Memorias de las que sale (eventos reales). */
  readonly sources: readonly EventId[];
  /** -1..1: valencia media ponderada por intensidad. */
  readonly valence: number;
  /** 0-1: cuánta carga emocional trae. */
  readonly arousal: number;
  readonly symbols: readonly string[];
  readonly nightmare: boolean;
}

export interface DreamInput {
  readonly dreamer: AgentId;
  readonly night: number;
  readonly memories: readonly Memory[];
  readonly now: Tick;
  readonly quality: number;
  /** Eventos que la pesadilla de la noche trajo (condiciones): entran primero como fuentes. */
  readonly nightmareCauses?: readonly EventId[];
  readonly themeOf: (m: Memory) => Theme | undefined;
  readonly rng: Rng;
}

/** Peso de una memoria para entrar a un sueño; 0 si no es del día ni intensa. */
export function dreamWeight(m: Memory, now: Tick): number {
  const recent = now - m.at <= RECENT_DAYS * DAY;
  if (!recent && m.intensity < INTENSE_FROM) return 0;
  return round(m.intensity * (0.5 + 0.5 * salienceAt(m, now)) * (recent ? 1 : 0.8));
}

/** Arma el sueño de la noche, o `undefined` si no hay materia (o se durmió demasiado mal). */
export function composeDream(i: DreamInput): Dream | undefined {
  if (i.quality < DREAM_MIN_QUALITY) return undefined;
  const woken = new Set(i.nightmareCauses ?? []);
  const ranked = i.memories
    .map((m) => ({ m, w: woken.has(m.eventId) ? 10 + m.intensity : dreamWeight(m, i.now) }))
    .filter((x) => x.w > 0)
    .sort((a, b) => b.w - a.w || (a.m.eventId < b.m.eventId ? -1 : 1))
    .slice(0, MAX_DREAM_SOURCES);
  if (ranked.length === 0) return undefined;

  const total = ranked.reduce((s, x) => s + x.m.intensity, 0);
  const valence =
    total > 0 ? ranked.reduce((s, x) => s + x.m.valence * x.m.intensity, 0) / total : 0;
  const arousal = clamp01(Math.max(...ranked.map((x) => x.m.intensity)));

  const symbols: string[] = [];
  for (const { m } of ranked) {
    const theme = i.themeOf(m);
    const pool = theme ? THEME_SYMBOLS[theme] : undefined;
    if (!pool || symbols.length >= MAX_SYMBOLS) continue;
    const s = pool[i.rng.int(0, pool.length - 1)];
    if (s !== undefined && !symbols.includes(s)) symbols.push(s);
  }
  return {
    dreamer: i.dreamer,
    night: i.night,
    sources: ranked.map((x) => x.m.eventId).sort(),
    valence: round(Math.max(-1, Math.min(1, valence))),
    arousal: round(arousal),
    symbols,
    nightmare: woken.size > 0,
  };
}
