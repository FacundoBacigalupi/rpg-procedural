// Lo que le pasa por la cabeza al personaje del jugador desde su mente (narration §7, npc-psychology
// §5 y §11): la pesadilla de la noche, el recuerdo que invade al ver a quien lo disparó, la pena por
// quien cree muerto y el susto que sigue encima. Solo lee la mente del personaje (`MENTAL`,
// `MEMORIES`, `BELIEFS`, `SLEEP_STATE`) y el registro: no escribe nada ni toca el estado, así que
// el replay no se entera. El azar sale de un rng con clave (mismo seed y tick, mismo pensamiento).
// Los recuerdos que no son firmes (deformados o poco creídos) salen como borrosos (`hazy`): el
// narrador no los cuenta como hechos. También decide el modo: sueño, secuela o salto de tiempo.

import { type AgentId, Rng, type Tick } from "../../core/index.ts";
import {
  BELIEFS,
  beliefConfidenceAt,
  believed,
  intrusionChance,
  MEMORIES,
  MENTAL,
  type Memory,
  memoriesAbout,
  triggeredBy,
} from "../../sim/index.ts";
import type { SpecialMode, ThoughtInput } from "../view/index.ts";
import { SLEEP_STATE } from "./sleep.ts";
import type { LifeWorld } from "./world.ts";

/** Cuántos pensamientos pasan a la vista como máximo en un turno. */
export const MAX_THOUGHTS = 3;
/** Desde cuánto susto sin soltar se nota como miedo. */
export const FEAR_NOTICE = 0.5;
/** Desde cuánta deformación (o poca fe en el recuerdo) un recuerdo sale borroso. */
export const HAZY_DISTORTION = 0.3;
export const HAZY_CONFIDENCE = 0.5;
/** Saliencia y peso mínimos del recuerdo de un muerto para que duela sin que nada lo traiga. */
export const GRIEF_SALIENCE = 0.3;
export const GRIEF_INTENSITY = 0.5;
/** Cuánta de la saliencia del recuerdo es chance de que duela este turno. */
export const GRIEF_RATE = 0.5;
/** Desde cuántos días sin ver el turno se cuenta como salto de tiempo. */
export const MONTAGE_DAYS = 7;

export interface ThoughtsIn {
  /** Desde cuándo pasó el turno (el inicio del reporte). */
  readonly since: Tick;
  /** Las personas que tiene delante y reconoce (dispara las condiciones). */
  readonly present: readonly AgentId[];
  /** Los conocidos del personaje: solo a ellos se les puede dar una etiqueta. */
  readonly known: ReadonlySet<string>;
}

export interface ThoughtsOut {
  readonly thoughts: readonly ThoughtInput[];
  readonly mode?: SpecialMode;
}

const hazyMemory = (m: Memory | undefined): boolean =>
  m !== undefined && (m.distortion >= HAZY_DISTORTION || m.confidence < HAZY_CONFIDENCE);

export function thoughtsOf(w: LifeWorld, input: ThoughtsIn): ThoughtsOut {
  const me = w.player;
  const now = w.scheduler.now;
  const since = input.since;
  const mental = w.truth.get(MENTAL, me);
  const memories = w.truth.get(MEMORIES, me);
  const rng = Rng.root(w.seed).fork("thoughts", me, now);
  const out: ThoughtInput[] = [];
  const about = (id: AgentId | undefined) =>
    id !== undefined && input.known.has(id) ? { about: id } : {};
  const memoryOf = (id: string) => memories?.items.find((m) => m.eventId === id);

  // El registro, de atrás para adelante hasta el inicio del turno: pesadilla de la noche.
  let dreamt = false;
  const events = w.log.all();
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (!e || e.tick < since) break;
    if (e.kind === "mind.nightmare" && e.actors.includes(me)) dreamt = true;
  }

  if (dreamt && mental) {
    const worst = [...mental.conditions].sort((a, b) => b.severity - a.severity)[0];
    const origin = worst?.originEventIds[0];
    out.push({
      kind: "feel",
      mood: worst?.kind === "guilt" ? "guilt" : "fear",
      ...(hazyMemory(origin === undefined ? undefined : memoryOf(origin)) ? { hazy: true } : {}),
    });
  }

  // Un recuerdo intrusivo al toparse con quien o con el lugar que lo despierta.
  if (mental && !dreamt) {
    for (const who of input.present) {
      const cue = { who };
      const chance = intrusionChance(mental, cue);
      if (chance <= 0 || rng.fork("intrude", who).float() >= chance) continue;
      const worst = [...triggeredBy(mental, cue)].sort((a, b) => b.severity - a.severity)[0];
      if (!worst) continue;
      out.push({
        kind: "remember",
        mood: worst.kind === "guilt" ? "guilt" : "fear",
        ...about(who),
        ...(hazyMemory(memoryOf(worst.originEventIds[0] ?? "")) ? { hazy: true } : {}),
      });
      break;
    }
  }

  // La pena por quien cree muerto y todavía pesa en el recuerdo.
  const beliefs = w.truth.get(BELIEFS, me);
  for (const id of [...input.known].sort()) {
    const b = believed(beliefs, id as AgentId, "alive");
    if (!b || b.value !== false || beliefConfidenceAt(b, now) < HAZY_CONFIDENCE) continue;
    const mem = memoriesAbout(memories, id as AgentId, now).find(
      (s) => s.salience >= GRIEF_SALIENCE && s.memory.intensity >= GRIEF_INTENSITY,
    );
    if (!mem || rng.fork("grief", id).float() >= mem.salience * GRIEF_RATE) continue;
    out.push({
      kind: "remember",
      mood: "grief",
      about: id as AgentId,
      ...(hazyMemory(mem.memory) ? { hazy: true } : {}),
    });
    break;
  }

  // El susto que sigue encima (el miedo de la última noche mal dormida).
  if ((w.truth.get(SLEEP_STATE, me)?.fear ?? 0) >= FEAR_NOTICE)
    out.push({ kind: "feel", mood: "fear" });

  const opened = mental?.conditions.some((c) => c.onset > since) === true;
  const mode: SpecialMode | undefined = dreamt
    ? "dream"
    : opened
      ? "aftermath"
      : now - since >= MONTAGE_DAYS * w.clock.day
        ? "montage"
        : undefined;
  return { thoughts: out.slice(0, MAX_THOUGHTS), ...(mode ? { mode } : {}) };
}
