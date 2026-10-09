// El apoyo que cura las condiciones mentales (npc-psychology §11, religion §14): la compañía de la
// casa y el consuelo del rito de la comunidad. Lo que cura depende de la condición: el trauma se
// calma sobre todo acompañado; la culpa, con el rito que la nombra y la deja pagar. Lo lee
// `life.consolidate` al asentar las condiciones cada noche. Puro salvo `supportFor`, que lee la verdad.

import type { AgentId } from "../../core/index.ts";
import {
  AMENDS,
  type Amends,
  affiliationOf,
  type CommunityReligion,
  type ConditionKind,
  comfortOf,
  ENTITY,
  type GuiltResponse,
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

/**
 * Cuánto del consuelo del rito le llega a la culpa según lo que decidió hacer con ella: el rito deja
 * pagar a quien confiesa o repara; quien evita lo recibe a medias y quien desvía casi no (sin
 * calibrar).
 */
export const RITE_FIT: Readonly<Record<GuiltResponse, number>> = {
  confess: 1,
  repair: 1,
  none: 0.7,
  avoid: 0.6,
  deflect: 0.3,
};

/** Lo que decidió hacer con su culpa más pesada (la del mayor `guilt` guardado), o `none`. */
export function heaviestResponse(amends: Amends | undefined): GuiltResponse {
  let best: GuiltResponse = "none";
  let weight = -1;
  for (const s of Object.values(amends?.byDeed ?? {})) {
    if (s.guilt > weight) {
      weight = s.guilt;
      best = s.response;
    }
  }
  return best;
}

/**
 * El apoyo (0-1) de una condición dados la compañía y el consuelo del rito (ambos 0-1). En la culpa,
 * el rito llega según lo decidido en `AMENDS` (`RITE_FIT`). Puro.
 */
export function supportOf(
  kind: ConditionKind,
  company: number,
  riteComfort: number,
  response: GuiltResponse = "confess",
): number {
  const w = SUPPORT_WEIGHTS[kind];
  const fit = kind === "guilt" ? RITE_FIT[response] : 1;
  const x =
    w.company * Math.min(1, Math.max(0, company)) +
    w.rite * fit * Math.min(1, Math.max(0, riteComfort));
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
  const response = heaviestResponse(truth.get(AMENDS, me));
  return (kind) => supportOf(kind, company, rite, response);
}
