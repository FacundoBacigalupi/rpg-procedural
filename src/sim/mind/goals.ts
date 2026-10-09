// Objetivos en capas (npc-psychology §7): núcleo, largo, mediano, corto e inmediato. Cada objetivo
// nace de algo con causa (`originEventId`): los núcleo, de los valores y de los esquemas que los
// empujan; la venganza, de la memoria que más dolió con esa persona cuando el resentimiento cruza
// un umbral que sube con la calidez y el control y baja con `strength_is_worth`. Nadie «decide ser
// villano» al azar. Puro: recibe valores, esquemas, memorias y relaciones; no mira la verdad.

import type { AgentId, EventId, Tick } from "../../core/index.ts";
import { compareStrings } from "../../core/index.ts";
import { type Memories, salienceAt } from "./memory.ts";
import type { Mind, SchemaDef, ValueId } from "./mind.ts";
import type { Drives } from "./utility.ts";

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

/** Cuánto suma un objetivo núcleo al peso de su valor en los impulsos (sin calibrar). */
export const GOAL_PULL = 0.5;

/**
 * Los objetivos como peso de impulsos: cada `pursue` suma `GOAL_PULL × peso` a su valor, así lo que
 * se propuso pesa más que el gusto de fondo. La venganza no suma acá: ya entra como candidata
 * (`avengeCandidate`) con el resentimiento de la relación.
 */
export function goalDrives(drives: Drives, goals: readonly Goal[]): Drives {
  const values: Partial<Record<ValueId, number>> = { ...drives.values };
  for (const g of goals) {
    if (g.kind !== "pursue" || g.value === undefined) continue;
    values[g.value] = r((values[g.value] ?? 0) + GOAL_PULL * g.weight);
  }
  return { ...drives, values };
}

export interface GoalChange {
  readonly born: readonly Goal[];
  readonly ended: readonly Goal[];
}

/** Qué objetivos nacieron y cuáles terminaron entre dos fotos (por id), en el orden de `next`/`prev`. */
export function goalChanges(prev: readonly Goal[], next: readonly Goal[]): GoalChange {
  const had = new Set(prev.map((g) => g.id));
  const has = new Set(next.map((g) => g.id));
  return {
    born: next.filter((g) => !had.has(g.id)),
    ended: prev.filter((g) => !has.has(g.id)),
  };
}

// --- Capas derivadas (largo, mediano, corto): se recalculan de la situación, no se guardan. ---

export const MAX_LONG_GOALS = 2;
export const MAX_MEDIUM_GOALS = 3;
export const MAX_SHORT_GOALS = 2;
/** Fuerza del esquema desde la que un valor núcleo se vuelve plan de vida (sin calibrar). */
export const LONG_SCHEMA_MIN = 0.3;
export const LONG_FACTOR = 0.8;
/** Resentimiento desde el que alguien es rival (y por debajo del umbral de venganza). */
export const RIVAL_MIN = 0.35;
/** Cercanía desde la que la familia es un objetivo mediano. */
export const KIN_CLOSE_MIN = 0.4;
/** Urgencia desde la que una necesidad es un objetivo corto. */
export const SHORT_NEED_MIN = 0.5;
/** Empuje por capa a los valores (sin calibrar): chico, solo desempata. */
export const LAYER_PULL = { long: 0.04, medium: 0.03, short: 0.02 } as const;

const NEED_VALUE: Readonly<Record<string, ValueId>> = {
  hunger: "safety",
  thirst: "safety",
  pain: "safety",
  safety: "safety",
  rest: "pleasure",
  social: "family",
};

/** El plan largo: los núcleo respaldados por un esquema fuerte, con su causa; cuelgan del núcleo. */
export function longGoals(core: readonly Goal[], mind: Mind, now: Tick): Goal[] {
  const out: Goal[] = [];
  for (const g of core) {
    if (g.kind !== "pursue" || g.value === undefined) continue;
    let best: { strength: number; cause: EventId } | undefined;
    for (const hold of Object.values(mind.schemas)) {
      const cause = hold.causes[hold.causes.length - 1];
      if (
        cause !== undefined &&
        hold.strength >= LONG_SCHEMA_MIN &&
        hold.strength > (best?.strength ?? 0)
      )
        best = { strength: hold.strength, cause };
    }
    if (best === undefined) continue;
    out.push({
      id: `long:${g.value}`,
      layer: "long",
      kind: "pursue",
      value: g.value,
      weight: r(g.weight * LONG_FACTOR * best.strength),
      originEventId: g.originEventId,
      parent: g.id,
      since: now,
    });
  }
  return out
    .sort((a, b) => b.weight - a.weight || compareStrings(a.id, b.id))
    .slice(0, MAX_LONG_GOALS);
}

export interface MediumInput {
  readonly who: AgentId;
  readonly resentment: number;
  /** 0-1: cercanía afectiva. */
  readonly closeness: number;
  readonly kin: boolean;
  /** 0-1: cuánto debe él a esa persona (deuda pendiente). */
  readonly debt: number;
}

/** El plan mediano: familia cercana, deudas y rivales; sin memoria con esa persona no nace (regla 5). */
export function mediumGoals(
  rels: readonly MediumInput[],
  s: RevengeSources,
  core: readonly Goal[],
): Goal[] {
  const coreIds = new Set(core.map((g) => g.id));
  const parentOf = (id: string) => (coreIds.has(id) ? { parent: id } : {});
  const threshold = revengeThreshold(s);
  const out: Goal[] = [];
  for (const rel of [...rels].sort((a, b) => compareStrings(a.who, b.who))) {
    let origin: { mass: number; id: EventId } | undefined;
    for (const m of s.memories?.items ?? []) {
      if (!m.perceived.with.includes(rel.who)) continue;
      const mass = m.intensity * salienceAt(m, s.now);
      if (origin === undefined || mass > origin.mass) origin = { mass, id: m.eventId };
    }
    if (origin === undefined) continue;
    const base = {
      layer: "medium",
      kind: "pursue",
      target: rel.who,
      originEventId: origin.id,
      since: s.now,
    } as const;
    if (rel.kin && rel.closeness >= KIN_CLOSE_MIN)
      out.push({
        ...base,
        id: `medium:kin:${rel.who}`,
        value: "family",
        weight: r(0.5 * clamp01(rel.closeness)),
        ...parentOf("core:family"),
      });
    if (rel.debt > 0)
      out.push({
        ...base,
        id: `medium:debt:${rel.who}`,
        value: "justice",
        weight: r(0.6 * clamp01(rel.debt)),
        ...parentOf("core:justice"),
      });
    if (rel.resentment >= RIVAL_MIN && rel.resentment < threshold)
      out.push({
        ...base,
        id: `medium:rival:${rel.who}`,
        value: "status",
        weight: r(0.5 * clamp01(rel.resentment)),
        ...parentOf("core:status"),
      });
  }
  return out
    .sort((a, b) => b.weight - a.weight || compareStrings(a.id, b.id))
    .slice(0, MAX_MEDIUM_GOALS);
}

/** El plan corto: las necesidades que apremian, como medio del núcleo de su valor si lo hay. */
export function shortGoals(
  needs: Readonly<Partial<Record<string, number>>>,
  core: readonly Goal[],
  origin: EventId,
  now: Tick,
): Goal[] {
  const coreIds = new Set(core.map((g) => g.id));
  const out: Goal[] = [];
  for (const need of Object.keys(needs).sort(compareStrings)) {
    const urgency = needs[need] ?? 0;
    const value = NEED_VALUE[need];
    if (value === undefined || urgency < SHORT_NEED_MIN) continue;
    const parent = `core:${value}`;
    out.push({
      id: `short:${need}`,
      layer: "short",
      kind: "pursue",
      value,
      weight: r(0.5 * clamp01(urgency)),
      originEventId: origin,
      ...(coreIds.has(parent) ? { parent } : {}),
      since: now,
    });
  }
  return out
    .sort((a, b) => b.weight - a.weight || compareStrings(a.id, b.id))
    .slice(0, MAX_SHORT_GOALS);
}

/** Empuje chico de las capas derivadas a los valores: desempata, no reemplaza al núcleo. */
export function layerDrives(drives: Drives, goals: readonly Goal[]): Drives {
  const values: Partial<Record<ValueId, number>> = { ...drives.values };
  for (const g of goals) {
    if (g.kind !== "pursue" || g.value === undefined) continue;
    if (g.layer !== "long" && g.layer !== "medium" && g.layer !== "short") continue;
    values[g.value] = r((values[g.value] ?? 0) + LAYER_PULL[g.layer] * g.weight);
  }
  return { ...drives, values };
}
