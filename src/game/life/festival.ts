// La fiesta (religion §3, §14): una práctica `festival` con `everyDays` junta a la aldea cada tanto.
// Va quien pertenece (con una tirada con clave por fiesta y por persona) y a todos los que van los
// alivia por igual el `comfortOf` de su afiliación, más pleno cuanta más gente hay. Puro: no
// escribe nada ni tira RNG fuera de las claves; el cableado al calendario ritual (que aún no existe)
// lo hará el proceso de religión de la Fase 3. Sin fiesta en la religión de la aldea no hace nada.

import type { AgentId, Rng } from "../../core/index.ts";
import {
  type Affiliation,
  affiliationOf,
  comfortOf,
  ENTITY,
  PERSON,
  type PracticeDef,
  practicesOfKind,
  RELIGIOUS_IDENTITY,
  type ReadonlyWorldTruth,
  villageReligion,
} from "../../sim/index.ts";

/** Chance de ir a una fiesta: × pertenencia (más que a un velorio ajeno: es de todos). */
export const FESTIVAL_ATTENDS = 0.6;
/** Cuántos asistentes (además de uno) dan el consuelo pleno. */
export const FULL_FESTIVAL = 12;
/** Mínimo del consuelo (casi a solas) contra el pleno (con toda la aldea). */
export const FESTIVAL_ALONE = 0.5;

/** Si a la práctica le toca fiesta en el día `day` (cada `everyDays`, nunca el día 0). Puro. */
export function festivalDue(practice: PracticeDef, day: number): boolean {
  if (practice.kind !== "festival" || practice.everyDays === undefined) return false;
  const every = Math.max(1, Math.round(practice.everyDays));
  return day > 0 && day % every === 0;
}

export interface Festival {
  /** La fiesta (id de la práctica) y el día en que se hizo. */
  readonly practice: string;
  readonly day: number;
  readonly attendees: readonly AgentId[];
  /** El consuelo (0-1) de cada asistente; el que no fue no tiene. */
  readonly comfort: ReadonlyMap<AgentId, number>;
}

/** La fiesta de `practice` en `day` para `people` (con su afiliación), o null si no fue nadie. Puro. */
export function festivalOf(
  practice: PracticeDef,
  day: number,
  people: readonly { readonly id: AgentId; readonly aff: Affiliation | undefined }[],
  rng: Rng,
): Festival | null {
  const going = people.filter(
    (p) =>
      p.aff !== undefined &&
      rng.fork("festival", practice.id, day, p.id).float() < FESTIVAL_ATTENDS * p.aff.belonging,
  );
  if (going.length === 0) return null;
  const company = Math.min(1, (going.length - 1) / FULL_FESTIVAL);
  const comfort = new Map<AgentId, number>();
  for (const p of going) {
    const full = comfortOf(practice, p.aff) * (FESTIVAL_ALONE + (1 - FESTIVAL_ALONE) * company);
    comfort.set(p.id, Math.round(full * 1000) / 1000);
  }
  return { practice: practice.id, day, attendees: going.map((p) => p.id), comfort };
}

/** Las fiestas que le tocan a la aldea en `day` (una por práctica `festival` vencida). */
export function villageFestivals(
  truth: ReadonlyWorldTruth,
  day: number,
  rng: Rng,
): readonly Festival[] {
  const community = villageReligion(truth);
  if (!community) return [];
  const due = practicesOfKind(community, "festival").filter((p) => festivalDue(p, day));
  if (due.length === 0) return [];
  const people = [...truth.ids(PERSON)]
    .map((raw) => raw as AgentId)
    .filter((id) => truth.get(ENTITY, id)?.endedAt === undefined)
    .map((id) => ({
      id,
      aff: affiliationOf(truth.get(RELIGIOUS_IDENTITY, id), community.religion),
    }));
  return due.flatMap((p) => {
    const f = festivalOf(p, day, people, rng);
    return f ? [f] : [];
  });
}
