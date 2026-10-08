// Consolidación nocturna de la memoria (npc-psychology §15, Fase 2). Una pasada por noche de
// sueño: las memorias con más emoción y relevancia ganan saliencia, las triviales se degradan más
// rápido, las parecidas se funden (la fuente de los recuerdos falsos con forma) y las que
// confirman un esquema lo refuerzan. Con mala calidad de sueño la pasada es pobre: refuerza
// menos, distorsiona más y funde más a lo bruto.
//
// Todo es puro: `consolidate` devuelve las memorias nuevas, el registro de la pasada y las
// confirmaciones de esquema; quien llama las escribe. El costo es lineal en la capacidad de
// memoria (≤ 20) y corre una vez por noche, no por hora. Todavía sin sueños con contenido
// (`Dream`) ni meditación: eso queda en el ROADMAP.

import { compareStrings, type EventId, type Rng, type Tick } from "../../core/index.ts";
import {
  compress,
  type Gist,
  type Memories,
  type Memory,
  type MemorySource,
  salienceAt,
} from "./memory.ts";
import type { Mind, SchemaDef, Theme } from "./mind.ts";

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const round = (x: number) => Math.round(x * 1e6) / 1e6;

/** Cuántas memorias como mucho se refuerzan por noche. */
export const MAX_STRENGTHENED = 3;
/** Puntaje mínimo (intensidad × relevancia) para que valga la pena reforzarla. */
export const STRENGTHEN_MIN = 0.3;
/** Fracción del hueco hasta 1 que sube la saliencia de una reforzada con calidad y puntaje 1. */
export const STRENGTHEN_GAIN = 0.35;
/** Bajo esta intensidad (y sin haberla recordado) la memoria es trivial. */
export const TRIVIAL_BELOW = 0.2;
/** Fracción de saliencia que pierde una trivial por noche (más si se durmió bien: se limpia). */
export const TRIVIAL_LOSS = 0.12;
/** Chance de fundir un par parecido en una noche de calidad 1 y en una de calidad 0. */
export const MERGE_CHANCE_GOOD = 0.05;
export const MERGE_CHANCE_POOR = 0.3;
/** Distorsión que suma una fusión (se escala por (1.5 - calidad)). */
export const MERGE_DISTORTION = 0.12;
/** Bajo esta calidad las reforzadas también se distorsionan un poco. */
export const POOR_SLEEP = 0.5;
export const POOR_DISTORTION = 0.04;
/** Cuánto sube un esquema por una confirmación (× intensidad × calidad × |efecto|). */
export const CONFIRM_RATE = 0.02;

/** Lo que se necesita de la noche para saber cuánto descansó la mente. */
export interface SleepFacts {
  /** Horas dormidas. */
  readonly hours: number;
  /** Horas que necesitaba. */
  readonly needHours: number;
  /** 0-1: frío, calor, ruido, dolor. */
  readonly discomfort?: number;
  /** 0-1: miedo o alerta (dormir en peligro). */
  readonly fear?: number;
  /** 0-1: pesadillas (trauma). */
  readonly nightmares?: number;
}

/** Calidad del sueño 0-1: horas contra necesidad, restada por incomodidad, miedo y pesadillas. */
export function sleepQuality(s: SleepFacts): number {
  const ratio = s.needHours <= 0 ? 1 : clamp01(s.hours / s.needHours);
  const bad =
    0.35 * clamp01(s.discomfort ?? 0) +
    0.3 * clamp01(s.fear ?? 0) +
    0.35 * clamp01(s.nightmares ?? 0);
  return round(clamp01(ratio * (1 - bad)));
}

export interface SchemaDelta {
  readonly schema: string;
  readonly delta: number;
  /** El evento de la memoria que confirmó el esquema. */
  readonly cause: EventId;
}

/** El registro de una noche (§15 `ConsolidationPass`). */
export interface ConsolidationPass {
  readonly night: Tick;
  readonly sleepQuality: number;
  /** Eventos de las memorias reforzadas. */
  readonly strengthened: readonly EventId[];
  /** [la que queda, la que se fundió en ella]. */
  readonly merged: readonly (readonly [EventId, EventId])[];
  /** Eventos de memorias triviales que perdieron saliencia. */
  readonly faded: readonly EventId[];
  readonly schemaUpdates: readonly SchemaDelta[];
}

export interface ConsolidationInput {
  readonly memories: Memories | undefined;
  readonly now: Tick;
  readonly quality: number;
  /** Stream de la noche: `rng.fork("psyche", npcId, night)`. */
  readonly rng: Rng;
  /** 0-1: cuánto importa la memoria para los objetivos de la persona (0 si no se pasa). */
  readonly relevance?: (m: Memory) => number;
  /** El tema que le toca a una memoria, para confirmar esquemas. */
  readonly themeOf?: (m: Memory) => Theme | undefined;
  /** Esquemas del mundo; sin ellos no hay confirmaciones. */
  readonly schemas?: readonly SchemaDef[];
  /** Mente actual, para saber hacia dónde confirma cada esquema. */
  readonly mind?: Mind;
}

export interface ConsolidationResult {
  readonly memories: Memories;
  readonly pass: ConsolidationPass;
}

const mergeKey = (m: Memory) =>
  `${m.perceived.kind}|${[...m.perceived.with].sort(compareStrings).join(",")}|${m.valence < 0 ? "-" : "+"}`;

const SOURCE_RANK: Readonly<Record<MemorySource, number>> = { witnessed: 2, told: 1, inferred: 0 };

/** Funde `drop` en `keep`: queda la más intensa, con confianza menor y más distorsión. */
export function mergeMemories(keep: Memory, drop: Memory, quality: number, now: Tick): Memory {
  const wk = Math.max(keep.intensity, 0.01);
  const wd = Math.max(drop.intensity, 0.01);
  const sk = salienceAt(keep, now);
  const sd = salienceAt(drop, now);
  const source = SOURCE_RANK[keep.source] >= SOURCE_RANK[drop.source] ? keep.source : drop.source;
  return {
    ...keep,
    source,
    intensity: round(Math.max(keep.intensity, drop.intensity)),
    valence: round((keep.valence * wk + drop.valence * wd) / (wk + wd)),
    confidence: round(Math.min(keep.confidence, drop.confidence) * 0.9),
    distortion: round(
      clamp01(Math.max(keep.distortion, drop.distortion) + MERGE_DISTORTION * (1.5 - quality)),
    ),
    salience: round(clamp01(Math.max(sk, sd) + 0.05)),
    measured: now,
    recalls: keep.recalls + drop.recalls,
  };
}

/** Una pasada de consolidación (§15). Determinista dado `rng`. */
export function consolidate(input: ConsolidationInput): ConsolidationResult {
  const { now, rng } = input;
  const q = clamp01(input.quality);
  let gists: readonly Gist[] = input.memories?.gists ?? [];
  let items = [...(input.memories?.items ?? [])];

  // 1) Reforzar lo emocional y relevante (con mala calidad, menos y con distorsión).
  const strengthened: EventId[] = [];
  const schemaUpdates: SchemaDelta[] = [];
  const scored = items
    .map((m, i) => ({
      i,
      m,
      score: m.intensity * (0.6 + 0.4 * clamp01(input.relevance?.(m) ?? 0)),
    }))
    .filter((e) => e.score >= STRENGTHEN_MIN)
    .sort((a, b) => b.score - a.score || compareStrings(a.m.eventId, b.m.eventId))
    .slice(0, MAX_STRENGTHENED);
  for (const e of scored) {
    const s = salienceAt(e.m, now);
    const poor = q < POOR_SLEEP;
    items[e.i] = {
      ...e.m,
      salience: round(s + STRENGTHEN_GAIN * q * e.score * (1 - s)),
      measured: now,
      distortion: poor
        ? round(clamp01(e.m.distortion + POOR_DISTORTION * (1 - q)))
        : e.m.distortion,
    };
    strengthened.push(e.m.eventId);
    // Confirmar un esquema: empuja en la dirección en que ya se inclina.
    const theme = input.themeOf?.(e.m);
    if (theme !== undefined && input.schemas && input.mind) {
      for (const d of input.schemas) {
        const effect = d.effects[theme] ?? 0;
        const hold = input.mind.schemas[d.id];
        if (effect === 0 || !hold) continue;
        const leansUp = hold.strength >= 0.5;
        if (leansUp !== effect > 0) continue;
        schemaUpdates.push({
          schema: d.id,
          delta: round(Math.sign(effect) * CONFIRM_RATE * e.m.intensity * q * Math.abs(effect)),
          cause: e.m.eventId,
        });
      }
    }
  }

  // 2) Degradar lo trivial (dormir bien limpia más).
  const faded: EventId[] = [];
  const done = new Set(strengthened);
  items = items.map((m) => {
    if (done.has(m.eventId) || m.intensity >= TRIVIAL_BELOW || m.recalls > 0) return m;
    faded.push(m.eventId);
    return {
      ...m,
      salience: round(salienceAt(m, now) * (1 - TRIVIAL_LOSS * (0.5 + 0.5 * q))),
      measured: now,
    };
  });

  // 3) Fundir un par parecido (como mucho uno por noche).
  const merged: [EventId, EventId][] = [];
  const groups = new Map<string, Memory[]>();
  for (const m of items) {
    const k = mergeKey(m);
    const g = groups.get(k);
    if (g) g.push(m);
    else groups.set(k, [m]);
  }
  const pairable = [...groups.entries()]
    .filter(([, g]) => g.length >= 2)
    .sort((a, b) => compareStrings(a[0], b[0]));
  if (pairable.length > 0) {
    const chance = MERGE_CHANCE_GOOD + (MERGE_CHANCE_POOR - MERGE_CHANCE_GOOD) * (1 - q);
    // Siempre se saca una tirada por pasada: el stream no depende de cuántos grupos haya.
    const roll = rng.float();
    const pick = rng.int(0, pairable.length - 1);
    if (roll < chance) {
      const group = [...(pairable[pick] as [string, Memory[]])[1]].sort(
        (a, b) => b.intensity - a.intensity || a.at - b.at || compareStrings(a.eventId, b.eventId),
      );
      const keep = group[0] as Memory;
      const drop = group[1] as Memory;
      const fused = mergeMemories(keep, drop, q, now);
      items = items.filter((m) => m !== drop).map((m) => (m === keep ? fused : m));
      gists = compress(gists, [drop]);
      merged.push([keep.eventId, drop.eventId]);
    }
  }

  items.sort((a, b) => a.at - b.at || compareStrings(a.eventId, b.eventId));
  return {
    memories: { items, gists: [...gists] },
    pass: {
      night: now,
      sleepQuality: q,
      strengthened,
      merged,
      faded,
      schemaUpdates,
    },
  };
}

/** Aplica las confirmaciones de esquema a la mente (fuerza en 0-1, el evento queda como causa). */
export function applySchemaUpdates(mind: Mind, updates: readonly SchemaDelta[]): Mind {
  if (updates.length === 0) return mind;
  const schemas = { ...mind.schemas };
  for (const u of updates) {
    const hold = schemas[u.schema];
    if (!hold) continue;
    const causes = hold.causes.includes(u.cause)
      ? hold.causes
      : [...hold.causes, u.cause].slice(-12);
    schemas[u.schema] = { strength: round(clamp01(hold.strength + u.delta)), causes };
  }
  return { ...mind, schemas };
}
