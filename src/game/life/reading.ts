// El testigo lee el porqué de lo que ve hacer (actions, ampliación 2026-10-08): cuando el personaje
// percibe la acción de otro, arma su `ReadPurpose` con lo que ve (el verbo, si es contra él, si fue
// a escondidas) y con lo que es él: su sospecha (esquema `people_are_untrustworthy` y poca
// calidez) y su aprecio por el actor (la relación). La lectura queda en `PURPOSE_READS`, puede
// errar y nunca toca la verdad del actor. El evento lleva el porqué real (`data.purpose`) solo
// como verdad del mundo: el lector no lo ve, la lectura sale de `readPurpose`.

import type { AgentId, Event, Rng, Tick } from "../../core/index.ts";
import {
  type Beliefs,
  type BondDef,
  believed,
  type DimensionDef,
  INNATE,
  learn,
  MIND,
  type Purpose,
  type PurposeContext,
  type PurposeReader,
  RELATIONS,
  type ReadonlyWorldTruth,
  type ReadPurpose,
  readPurpose,
  relationship,
  table,
} from "../../sim/index.ts";
import { groupBiasToward } from "./identity.ts";

/** Lo que el personaje leyó de los porqués ajenos, los más nuevos al final. */
export interface PurposeReads {
  readonly recent: readonly ReadPurpose[];
}

export const PURPOSE_READS = table<PurposeReads>("life.purpose_reads");

/** Cuántas lecturas guarda (las viejas se olvidan). */
export const KEPT_READS = 20;

/** Con qué se arma al lector: las dimensiones de relación para mirar su aprecio. */
export interface ReaderContent {
  readonly dims: readonly DimensionDef[];
  readonly bonds: readonly BondDef[];
}

/** Cuánto pesa el sesgo de grupo (-1..1) en el aprecio y en la sospecha al leer un porqué. */
export const GROUP_REGARD = 0.5;
export const GROUP_SUSPICION = 0.5;

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** El lector: sospecha desde esquemas y temperamento, aprecio desde la relación hacia el actor. */
export function purposeReaderOf(
  truth: ReadonlyWorldTruth,
  reader: AgentId,
  actor: AgentId,
  now: Tick,
  content?: ReaderContent,
): PurposeReader {
  const schemas = truth.get(MIND, reader)?.schemas ?? {};
  const warmth = truth.get(INNATE, reader)?.["warmth"] ?? 0.5;
  // El grupo que cree que es el actor: los suyos inspiran confianza, los de afuera desconfianza.
  const bias = groupBiasToward(truth, reader, actor);
  const suspicion = clamp(
    (schemas["people_are_untrustworthy"]?.strength ?? 0) +
      0.25 * (0.5 - warmth) -
      GROUP_SUSPICION * bias,
    0,
    1,
  );
  const regard =
    content === undefined
      ? 0
      : clamp(
          relationship(truth.get(RELATIONS, reader), actor, now, {
            dims: content.dims,
            bonds: content.bonds,
            schemaStrength: (s) => schemas[s]?.strength ?? 0,
          }).dims.affection,
          -1,
          1,
        );
  return { id: reader, regard: clamp(regard + GROUP_REGARD * bias, -1, 1), suspicion };
}

/** El porqué real que lleva un evento de acción, si el plan lo declaró. */
export function purposeOfEvent(e: Pick<Event, "data">): Purpose | undefined {
  const p = (e.data as { purpose?: Purpose } | null)?.purpose;
  return p?.motive === undefined ? undefined : p;
}

/** Lo que ve el lector de la acción: verbo, si recae en alguien, si es él y si se ocultó. */
export function purposeContextOf(e: Event, reader: AgentId): PurposeContext {
  const data = e.data as { verb?: string; manner?: string[] } | null;
  const targets = e.actors.slice(1);
  return {
    verb: data?.verb ?? e.kind.replace(/^action\./, ""),
    tenure: "none",
    covert: (data?.manner ?? []).some((m) => m === "covert"),
    onPerson: targets.length > 0,
    readerIsTarget: targets.includes(reader),
  };
}

/** La lectura del testigo sobre una acción que percibió, o `undefined` si no trae porqué. */
export function readWitnessed(
  rng: Rng,
  truth: ReadonlyWorldTruth,
  reader: AgentId,
  e: Event,
  content?: ReaderContent,
): ReadPurpose | undefined {
  const actor = e.actors[0] as AgentId | undefined;
  const purpose = purposeOfEvent(e);
  if (actor === undefined || purpose === undefined || actor === reader) return undefined;
  return readPurpose(
    rng,
    actor,
    purpose,
    purposeContextOf(e, reader),
    purposeReaderOf(truth, reader, actor, e.tick, content),
    e.tick,
  );
}

/** Lo que el lector tiene guardado después de sumar `fresh`. */
export function rememberReads(
  truth: ReadonlyWorldTruth,
  reader: AgentId,
  fresh: readonly ReadPurpose[],
): PurposeReads {
  const before = truth.get(PURPOSE_READS, reader)?.recent ?? [];
  return { recent: [...before, ...fresh].slice(-KEPT_READS) };
}

/** Cuánto atrás mira `learnReads` (dos pasadas de hora, para no perder lo que cayó entre medio). */
export const READ_WINDOW = 2 * 3_600;

/**
 * Pasa las lecturas recientes del personaje a sus creencias (information §1): «X se propone M»
 * con la confianza de la lectura y fuente `reasoning` (de qué la sacó: lo declarado o lo supuesto
 * por la acción). Una lectura ya incorporada (misma fuente en ese instante) no suma otra vez.
 */
export function learnReads(
  before: Beliefs | undefined,
  reads: readonly ReadPurpose[],
  now: Tick,
): Beliefs | undefined {
  let beliefs = before;
  for (const r of reads) {
    if (r.tick > now || r.tick < now - READ_WINDOW) continue;
    const prev = believed(beliefs, r.actor, "purpose");
    if (prev?.sources.some((s) => s.kind === "reasoning" && s.tick === r.tick)) continue;
    beliefs = learn(
      beliefs,
      {
        prop: { kind: "attr", subject: r.actor, attr: "purpose" },
        value: r.guessed,
        confidence: r.confidence,
        asOf: r.tick,
        source: { kind: "reasoning", evidence: [`read:${r.basis}`], rules: [], tick: r.tick },
      },
      now,
    );
  }
  return beliefs;
}
