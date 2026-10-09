// El velorio (religion §14, npc-psychology §11): cuando alguien muere y la religión de la aldea
// tiene un rito, la gente se junta. Quién va lo decide su pertenencia (los dolientes van casi
// siempre; el resto de la aldea, a veces) con una tirada con clave por muerto y por persona. El
// consuelo de cada doliente es el `comfortOf` del rito con su propia afiliación, más pleno cuanta
// más gente acompaña. Lo lee `life.appraise` al `body.died` (alivia el duelo, no lo borra) y deja el
// evento `religion.wake` con los asistentes. Puro sobre la verdad.

import type { AgentId, Rng } from "../../core/index.ts";
import {
  affiliationOf,
  comfortOf,
  ENTITY,
  PERSON,
  practicesOfKind,
  RELIGIOUS_IDENTITY,
  type ReadonlyWorldTruth,
  villageReligion,
} from "../../sim/index.ts";

export const WAKE_EVENT = "religion.wake";

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
