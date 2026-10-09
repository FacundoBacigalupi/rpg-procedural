// Objetivos en capas (npc-psychology §7): núcleo, largo, mediano, corto e inmediato. Cada objetivo
// nace de algo con causa (`originEventId`): los núcleo, de los valores y de los esquemas que los
// empujan; la venganza, de la memoria que más dolió con esa persona cuando el resentimiento cruza
// un umbral que sube con la calidez y el control y baja con `strength_is_worth`. Nadie «decide ser
// villano» al azar. Puro: recibe valores, esquemas, memorias y relaciones; no mira la verdad.

import type { AgentId, EventId, Tick } from "../../core/index.ts";
import { compareStrings } from "../../core/index.ts";
import { type Memories, salienceAt } from "./memory.ts";
import type { Mind, SchemaDef, ValueId } from "./mind.ts";

export const GOAL_LAYERS = ["core", "long", "medium", "short", "immediate"] as const;
export type GoalLayer = (typeof GOAL_LAYERS)[number];

export interface Goal {
  /** Estable: `core:family`, `core:avenge:agent:7`. */
  readonly id: string;
  readonly layer: GoalLayer;
  /** `pursue` un valor, `avenge` a alguien. */
  readonly kind: "pursue" | "avenge";
  readonly value?: ValueId;
  readonly target?: AgentId;
  /** 0-1: cuánto pesa. */
  readonly weight: number;
  /** Por qué existe (regla 5): el evento que lo hizo nacer. */
  readonly originEventId: EventId;
  /** El objetivo de una capa más alta al que sirve, si es medio para otro. */
  readonly parent?: string;
  readonly since: Tick;
}

/** Peso de valor (normalizado a suma 1) desde el que un valor es un objetivo núcleo (sin calibrar). */
export const CORE_VALUE_MIN = 0.14;
/** Resentimiento base desde el que nace una venganza (sin calibrar). */
export const REVENGE_BASE = 0.6;
export const REVENGE_WARMTH = 0.2;
export const REVENGE_CONTROL = 0.2;
export const REVENGE_STRENGTH = 0.25;
export const MAX_CORE_GOALS = 3;

const r = (x: number) => Math.round(x * 1e6) / 1e6;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Los valores fuertes de alguien como objetivos núcleo, con el esquema que más los empuja de origen. */
export function coreGoals(
  values: Readonly<Record<ValueId, number>>,
  schemaDefs: readonly SchemaDef[],
  mind: Mind,
  now: Tick,
): Goal[] {
  const strong = (Object.keys(values) as ValueId[])
    .filter((v) => values[v] >= CORE_VALUE_MIN)
    .sort((a, b) => values[b] - values[a] || compareStrings(a, b))
    .slice(0, MAX_CORE_GOALS);
  return strong.map((value) => {
    let best: { push: number; cause: EventId } | undefined;
    for (const d of schemaDefs) {
      const hold = mind.schemas[d.id];
      const push = (d.values[value] ?? 0) * (hold?.strength ?? 0);
      const cause = hold?.causes[hold.causes.length - 1];
      if (cause !== undefined && push > 0 && (best === undefined || push > best.push))
        best = { push, cause };
    }
    return {
      id: `core:${value}`,
      layer: "core",
      kind: "pursue",
      value,
      weight: r(values[value]),
      originEventId: best?.cause ?? mind.originEventId,
      since: now,
    };
  });
}

export interface RevengeInput {
  readonly who: AgentId;
  /** Dimensión `resentment` de la relación, 0-1. */
  readonly resentment: number;
}

export interface RevengeSources {
  readonly memories: Memories | undefined;
  readonly now: Tick;
  /** Temperamento: calidez y control, 0-1. */
  readonly warmth: number;
  readonly control: number;
  /** Fuerza del esquema `strength_is_worth`, 0-1. */
  readonly strengthIsWorth: number;
}

/** Resentimiento que hace falta para querer venganza: los cálidos y contenidos aguantan más. */
export function revengeThreshold(
  s: Pick<RevengeSources, "warmth" | "control" | "strengthIsWorth">,
): number {
  return r(
    REVENGE_BASE +
      REVENGE_WARMTH * clamp01(s.warmth) +
      REVENGE_CONTROL * clamp01(s.control) -
      REVENGE_STRENGTH * clamp01(s.strengthIsWorth),
  );
}

/** Venganzas que nacen: resentimiento sobre el umbral, con la memoria más dolorosa como origen. */
export function revengeGoals(rels: readonly RevengeInput[], s: RevengeSources): Goal[] {
  const threshold = revengeThreshold(s);
  const out: Goal[] = [];
  for (const rel of [...rels].sort((a, b) => compareStrings(a.who, b.who))) {
    if (rel.resentment < threshold) continue;
    let origin: { pain: number; id: EventId } | undefined;
    for (const m of s.memories?.items ?? []) {
      if (!m.perceived.with.includes(rel.who) || m.valence >= 0) continue;
      const pain = m.intensity * salienceAt(m, s.now) * -m.valence;
      if (origin === undefined || pain > origin.pain) origin = { pain, id: m.eventId };
    }
    // Sin memoria que lo explique no hay origen: no nace (regla 5).
    if (origin === undefined) continue;
    out.push({
      id: `core:avenge:${rel.who}`,
      layer: "core",
      kind: "avenge",
      target: rel.who,
      weight: r(clamp01(rel.resentment)),
      originEventId: origin.id,
      since: s.now,
    });
  }
  return out;
}

/** Une lo vigente con lo recién derivado: conserva `since` y el origen de los que siguen; los que ya no, se van. */
export function reconcileGoals(prev: readonly Goal[], next: readonly Goal[]): Goal[] {
  const old = new Map(prev.map((g) => [g.id, g]));
  return next
    .map((g) => {
      const was = old.get(g.id);
      return was ? { ...g, since: was.since, originEventId: was.originEventId } : g;
    })
    .sort(
      (a, b) =>
        GOAL_LAYERS.indexOf(a.layer) - GOAL_LAYERS.indexOf(b.layer) ||
        b.weight - a.weight ||
        compareStrings(a.id, b.id),
    );
}
