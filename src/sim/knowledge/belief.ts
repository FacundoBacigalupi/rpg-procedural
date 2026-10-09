// Creencias (information §1, Fase 2): lo que cada quien cree de otro, aparte de la verdad. Una
// creencia es una proposición de un catálogo cerrado con un valor, una confianza, a qué momento
// del mundo se refiere (`asOf`), cuándo se enteró y de dónde salió. Hay una por proposición y por
// quien cree: llegar evidencia nueva la revisa (`revise`), no agrega otra. La confianza decae
// perezosa con el tiempo (lo que se sabe de dónde está alguien envejece en horas) y la saliencia
// decide qué se olvida cuando no entra todo.
//
// Alcance de este primer paso: dos atributos de una persona (`at`, `alive`), valor escalar con
// confianza y fuente de percept o de oídas. Distribuciones, inferencias, rumores y el resto de los
// moldes llegan con sus ítems (información Fase 3).

import {
  type AgentId,
  compareStrings,
  type EventId,
  exp,
  LN2,
  type Tick,
} from "../../core/index.ts";
import { type Location, table } from "../world/index.ts";

const HOUR = 3_600;
const DAY = 86_400;

/** Qué se cree de alguien: dónde está, si vive y qué se propone (el motivo que le leyó a un acto). */
export const ATTR_KEYS = ["at", "alive", "purpose"] as const;
export type AttrKey = (typeof ATTR_KEYS)[number];

export interface Proposition {
  readonly kind: "attr";
  readonly subject: AgentId;
  readonly attr: AttrKey;
}

/** `at` guarda un lugar; `alive`, un booleano; `purpose`, el id del motivo creído. */
export type BeliefValue = Location | boolean | string;

export type BeliefSource =
  | {
      readonly kind: "percept";
      readonly percept: string;
      readonly tick: Tick;
      readonly event?: EventId;
    }
  | { readonly kind: "told"; readonly from: AgentId; readonly tick: Tick }
  /** Una conclusión: de qué evidencia citable (refs) y con qué reglas salió. */
  | {
      readonly kind: "reasoning";
      readonly evidence: readonly string[];
      readonly rules: readonly string[];
      readonly tick: Tick;
    };

export interface Belief {
  readonly prop: Proposition;
  readonly value: BeliefValue;
  /** 0-1 a `measured`; después decae (`beliefConfidenceAt`). */
  readonly confidence: number;
  /** A qué momento del mundo se refiere (no cuándo se enteró). */
  readonly asOf: Tick;
  readonly learnedAt: Tick;
  /** Las últimas fuentes, la más nueva al final. */
  readonly sources: readonly BeliefSource[];
  /** 0-1 a `measured`; decide el olvido. */
  readonly salience: number;
  readonly measured: Tick;
}

export interface Beliefs {
  readonly items: readonly Belief[];
}

/** Las creencias de una persona, en su entidad. */
export const BELIEFS = table<Beliefs>("knowledge.beliefs");

/** Cuántas creencias guarda cada persona (las de menor saliencia se olvidan). */
export const BELIEF_CAPACITY = 100;
export const MAX_SOURCES = 4;
/** Vida media de la confianza, en horas: dónde está alguien envejece rápido; que vive, despacio. */
export const CONFIDENCE_HALF_LIFE_HOURS: Readonly<Record<AttrKey, number>> = {
  at: 6,
  alive: 24 * 14,
  purpose: 24 * 30,
};
/** Vida media de la saliencia (días). */
export const SALIENCE_HALF_LIFE_DAYS = 30;
/** Tope de confianza por repetición: nadie se vuelve del todo seguro por ver lo mismo. */
export const CONFIDENCE_CAP = 0.99;
/** Cuánto baja la confianza de lo nuevo por contradecir lo que ya creía. */
export const CONFLICT_PENALTY = 0.3;
/** Peso de una evidencia más vieja que lo que ya cree. */
export const STALE_EVIDENCE = 0.5;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const round = (x: number) => Math.round(x * 1e6) / 1e6;

export function propKey(p: Proposition): string {
  return `${p.kind}:${p.subject}:${p.attr}`;
}

export function sameValue(a: BeliefValue, b: BeliefValue): boolean {
  if (typeof a === "boolean" || typeof b === "boolean") return a === b;
  if (typeof a === "string" || typeof b === "string") return a === b;
  return a.hex === b.hex && (a.space ?? "") === (b.space ?? "");
}

/** La confianza de `b` al momento `now`, ya envejecida. */
export function beliefConfidenceAt(b: Belief, now: Tick): number {
  const elapsed = Math.max(0, now - b.measured);
  const half = CONFIDENCE_HALF_LIFE_HOURS[b.prop.attr] * HOUR;
  return round(b.confidence * exp((-LN2 * elapsed) / half));
}

export function beliefSalienceAt(b: Belief, now: Tick): number {
  const elapsed = Math.max(0, now - b.measured);
  return round(b.salience * exp((-LN2 * elapsed) / (SALIENCE_HALF_LIFE_DAYS * DAY)));
}

export interface Evidence {
  readonly prop: Proposition;
  readonly value: BeliefValue;
  /** Cuánto se fía de lo que leyó (en un percept, la chance de leerlo; contado, la credibilidad). */
  readonly confidence: number;
  readonly asOf: Tick;
  readonly source: BeliefSource;
}

/**
 * Combina lo que ya cree con la evidencia nueva (information §1, revisión). Lo mismo se refuerza
 * (sube sin pasar del tope); lo distinto reemplaza si pesa más que lo que quedaba de confianza en
 * lo viejo, y entonces llega con menos confianza por haber chocado; si no pesa, se queda lo viejo
 * un poco más dudoso. La evidencia más vieja que lo que cree pesa la mitad.
 */
export function revise(prev: Belief | undefined, ev: Evidence, now: Tick): Belief {
  const w = clamp01(ev.confidence);
  const fresh = (confidence: number, sources: readonly BeliefSource[], from?: Belief): Belief => ({
    prop: ev.prop,
    value: ev.value,
    confidence: round(clamp01(confidence)),
    asOf: from === undefined ? ev.asOf : Math.max(from.asOf, ev.asOf),
    learnedAt: from === undefined ? now : from.learnedAt,
    sources: sources.slice(-MAX_SOURCES),
    salience: round(clamp01(Math.max(w, from === undefined ? 0 : beliefSalienceAt(from, now)))),
    measured: now,
  });
  if (prev === undefined) return fresh(w, [ev.source]);
  const old = beliefConfidenceAt(prev, now);
  const sources = [...prev.sources, ev.source];
  if (sameValue(prev.value, ev.value)) {
    const merged = Math.min(CONFIDENCE_CAP, 1 - (1 - old) * (1 - w));
    return { ...fresh(merged, sources, prev), value: prev.value };
  }
  const weight = w * (ev.asOf >= prev.asOf ? 1 : STALE_EVIDENCE);
  if (weight > old) {
    return { ...fresh(weight * (1 - CONFLICT_PENALTY * old), sources, prev), asOf: ev.asOf };
  }
  return {
    ...prev,
    confidence: round(old * (1 - 0.2 * weight)),
    measured: now,
    salience: round(Math.max(beliefSalienceAt(prev, now), weight * 0.5)),
  };
}

/** Suma o revisa la creencia de `ev.prop`; si no entran todas, se olvidan las menos salientes. */
export function learn(before: Beliefs | undefined, ev: Evidence, now: Tick): Beliefs {
  const key = propKey(ev.prop);
  const items = before?.items ?? [];
  const prev = items.find((b) => propKey(b.prop) === key);
  const next = revise(prev, ev, now);
  const rest = items.filter((b) => propKey(b.prop) !== key);
  const all = [...rest, next];
  if (all.length <= BELIEF_CAPACITY) return { items: all };
  const kept = [...all]
    .sort(
      (a, b) =>
        beliefSalienceAt(b, now) - beliefSalienceAt(a, now) ||
        compareStrings(propKey(a.prop), propKey(b.prop)),
    )
    .slice(0, BELIEF_CAPACITY);
  return { items: kept };
}

/** Lo que `holder` cree de `subject` sobre `attr`, o `undefined` si no sabe nada. */
export function believed(
  beliefs: Beliefs | undefined,
  subject: AgentId,
  attr: AttrKey,
): Belief | undefined {
  return beliefs?.items.find((b) => b.prop.subject === subject && b.prop.attr === attr);
}
