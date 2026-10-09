// El velorio (religion §14, npc-psychology §11): cuando alguien muere y la religión de la aldea
// tiene un rito, la gente se junta. Quién va lo decide su pertenencia (los dolientes van casi
// siempre; el resto de la aldea, a veces) con una tirada con clave por muerto y por persona. El
// consuelo de cada doliente es el `comfortOf` del rito con su propia afiliación, más pleno cuanta
// más gente acompaña. Lo lee `life.appraise` al `body.died` (alivia el duelo, no lo borra) y deja el
// evento `religion.wake` con los asistentes. Puro sobre la verdad.

import type { AgentId, EventId, Rng } from "../../core/index.ts";
import {
  affiliationOf,
  comfortOf,
  ENTITY,
  PERSON,
  practicesOfKind,
  RELIGIOUS_IDENTITY,
  type ReadonlyWorldTruth,
  table,
  villageReligion,
} from "../../sim/index.ts";

export const WAKE_EVENT = "religion.wake";

/** El consuelo de un velorio al que fue el doliente, con la muerte que lo motivó. */
export interface WakeComfortItem {
  readonly event: EventId;
  /** El muerto: la condición que lo tiene de disparador (trauma tras matarlo, verlo) lo liga. */
  readonly dead: AgentId;
  readonly comfort: number;
}

/** Los velorios a los que fue cada persona (los últimos `WAKE_COMFORT_CAPACITY`). */
export interface WakeComforts {
  readonly items: readonly WakeComfortItem[];
}

export const WAKE_COMFORT = table<WakeComforts>("life.wake_comfort");
export const WAKE_COMFORT_CAPACITY = 8;

/** Suma el consuelo de un velorio a los que ya tenía; lo más viejo se olvida al llenarse. Puro. */
export function withWakeComfort(
  current: WakeComforts | undefined,
  event: EventId,
  dead: AgentId,
  comfort: number,
): WakeComforts {
  const rest = (current?.items ?? []).filter((i) => i.event !== event);
  return { items: [...rest, { event, dead, comfort }].slice(-WAKE_COMFORT_CAPACITY) };
}

/**
 * El consuelo del velorio ligado a una condición (el mayor): el de la muerte que la abrió o el del
 * muerto que es su disparador; undefined si no fue a ninguno. Puro.
 */
export function wakeComfortFor(
  current: WakeComforts | undefined,
  condition: {
    readonly originEventIds: readonly EventId[];
    readonly triggers: readonly { readonly who?: AgentId }[];
  },
): number | undefined {
  let best: number | undefined;
  for (const i of current?.items ?? []) {
    const linked =
      condition.originEventIds.includes(i.event) ||
      condition.triggers.some((t) => t.who === i.dead);
    if (linked) best = Math.max(best ?? 0, i.comfort);
  }
  return best;
}

/** Cuántos acompañantes (además del doliente) dan el consuelo pleno. */
export const FULL_WAKE = 6;
/** Mínimo del consuelo (a solas con el rito) contra el pleno (acompañado por todos). */
export const WAKE_ALONE = 0.5;
/** Chance de ir de los dolientes (0,5 + 0,5 × pertenencia) y de los demás (× pertenencia). */
export const MOURNER_ATTENDS = 0.5;
export const VILLAGER_ATTENDS = 0.12;

export interface Wake {
  /** El rito (id de la práctica) que se hizo. */
  readonly practice: string;
  readonly attendees: readonly AgentId[];
  /** El consuelo (0-1) de cada doliente que fue; el que no fue no tiene. */
  readonly comfort: ReadonlyMap<AgentId, number>;
}

/** El velorio de `dead` para sus `mourners`, o null si la aldea no tiene un rito o no fue nadie. */
export function wakeOf(
  truth: ReadonlyWorldTruth,
  dead: AgentId,
  mourners: readonly AgentId[],
  rng: Rng,
): Wake | null {
  const community = villageReligion(truth);
  const practice = practicesOfKind(community, "rite")[0];
  if (!community || !practice) return null;
  const grieving = new Set(mourners);
  const attendees: AgentId[] = [];
  for (const raw of truth.ids(PERSON)) {
    const id = raw as AgentId;
    if (id === dead || truth.get(ENTITY, id)?.endedAt !== undefined) continue;
    const aff = affiliationOf(truth.get(RELIGIOUS_IDENTITY, id), community.religion);
    if (!aff) continue;
    const chance = grieving.has(id)
      ? MOURNER_ATTENDS + (1 - MOURNER_ATTENDS) * aff.belonging
      : VILLAGER_ATTENDS * aff.belonging;
    if (rng.fork("wake", dead, id).float() < chance) attendees.push(id);
  }
  if (attendees.length === 0) return null;
  const comfort = new Map<AgentId, number>();
  for (const id of attendees) {
    if (!grieving.has(id)) continue;
    const aff = affiliationOf(truth.get(RELIGIOUS_IDENTITY, id), community.religion);
    const company = Math.min(1, (attendees.length - 1) / FULL_WAKE);
    const full = comfortOf(practice, aff) * (WAKE_ALONE + (1 - WAKE_ALONE) * company);
    comfort.set(id, Math.round(full * 1000) / 1000);
  }
  return { practice: practice.id, attendees, comfort };
}
