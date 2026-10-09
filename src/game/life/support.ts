// El apoyo que cura las condiciones mentales (npc-psychology §11, religion §14): la compañía de la
// casa y el consuelo del rito de la comunidad. Lo que cura depende de la condición: el trauma se
// calma sobre todo acompañado; la culpa, con el rito que la nombra y la deja pagar. Lo lee
// `life.consolidate` al asentar las condiciones cada noche. Puro salvo `supportFor`, que lee la verdad.

import type { AgentId } from "../../core/index.ts";
import {
  affiliationOf,
  type CommunityReligion,
  type ConditionKind,
  comfortOf,
  ENTITY,
  PERSON,
  practicesOfKind,
  RELIGIOUS_IDENTITY,
  type ReadonlyWorldTruth,
  villageReligion,
} from "../../sim/index.ts";

/** Cuántos de la casa a la vez dan la compañía plena. */
export const FULL_COMPANY = 4;
/** Peso de la compañía y del rito en el apoyo de cada condición. */
export const SUPPORT_WEIGHTS: Readonly<Record<ConditionKind, { company: number; rite: number }>> = {
  trauma: { company: 0.5, rite: 0.2 },
  guilt: { company: 0.2, rite: 0.5 },
};

/** El apoyo (0-1) de una condición dados la compañía y el consuelo del rito (ambos 0-1). Puro. */
export function supportOf(kind: ConditionKind, company: number, riteComfort: number): number {
  const w = SUPPORT_WEIGHTS[kind];
  const x =
    w.company * Math.min(1, Math.max(0, company)) + w.rite * Math.min(1, Math.max(0, riteComfort));
  return Math.min(1, x);
}

/** El mayor consuelo de los ritos de la comunidad para quien tiene esa identidad. */
export function riteComfortOf(
  community: CommunityReligion | undefined,
  identity: Parameters<typeof affiliationOf>[0],
): number {
  if (!community) return 0;
  const aff = affiliationOf(identity, community.religion);
  let best = 0;
  for (const p of practicesOfKind(community, "rite")) best = Math.max(best, comfortOf(p, aff));
  return best;
}

/** Cuánta compañía tiene `me` en su casa (vivos que no son él, sobre `FULL_COMPANY`). */
export function companyOf(truth: ReadonlyWorldTruth, me: AgentId): number {
  const home = truth.get(PERSON, me)?.household;
  if (home === undefined) return 0;
  let n = 0;
  for (const id of truth.ids(PERSON)) {
    if (id === me) continue;
    if (truth.get(PERSON, id)?.household !== home) continue;
    if (truth.get(ENTITY, id)?.endedAt !== undefined) continue;
    n++;
  }
  return Math.min(1, n / FULL_COMPANY);
}

/** El apoyo de `me` por condición: lo lee `settleConditions`. */
export function supportFor(
  truth: ReadonlyWorldTruth,
  me: AgentId,
): (kind: ConditionKind) => number {
  const company = companyOf(truth, me);
  const rite = riteComfortOf(villageReligion(truth), truth.get(RELIGIOUS_IDENTITY, me));
  return (kind) => supportOf(kind, company, rite);
}
