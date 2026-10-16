// Autoridad de aldea (organizations §11, body-health §6): lo que el consejo le impone al paciente
// frente a un contagio. Cada miembro vivo del consejo del asentamiento del paciente es una fuente
// de autoridad: pesa lo que cree que se pega por su rango (el cabeza más que un anciano); después
// `combineAuthorities` la pondera por el respeto que el paciente le tiene a cada uno (RELATIONS).
// Puro: solo lee la verdad; la lealtad es la relación `respect` ya guardada, sin tabla nueva.

import type { AgentId } from "../../core/index.ts";
import { activeMembers, HOUSEHOLD, ORG, PERSON, type ReadonlyWorldTruth } from "../../sim/index.ts";
import {
  type AuthoritySource,
  combineAuthorities,
  contagionBeliefOf,
  householdHead,
  type PatientBondsOptions,
} from "./patientbonds.ts";

export interface CouncilAuthorityOptions extends PatientBondsOptions {
  /** Fuerza del cabeza del consejo (0-1, por defecto 1). */
  readonly headStrength?: number;
  /** Fuerza de un anciano del consejo (0-1, por defecto 0,6). */
  readonly elderStrength?: number;
}

export const DEFAULT_HEAD_STRENGTH = 1;
export const DEFAULT_ELDER_STRENGTH = 0.6;

/** Las autoridades del consejo del asentamiento del paciente: miembros activos, en orden de id. */
export function councilSources(
  truth: ReadonlyWorldTruth,
  patient: AgentId,
  pathogen: string,
  o: CouncilAuthorityOptions = {},
): readonly AuthoritySource[] {
  const home = truth.get(PERSON, patient)?.household;
  const settlement = home === undefined ? undefined : truth.get(HOUSEHOLD, home)?.settlement;
  if (settlement === undefined) return [];
  const belief = contagionBeliefOf(truth, pathogen, o);
  const head = o.headStrength ?? DEFAULT_HEAD_STRENGTH;
  const elder = o.elderStrength ?? DEFAULT_ELDER_STRENGTH;
  const out: AuthoritySource[] = [];
  for (const id of [...truth.ids(ORG)].sort()) {
    const org = truth.get(ORG, id);
    if (org?.status !== "active" || org.settlement !== settlement) continue;
    for (const m of activeMembers(org)) {
      out.push({ holder: m.agent, strength: belief * (m.rank === "head" ? head : elder) });
    }
  }
  return out.sort((a, b) => (a.holder < b.holder ? -1 : a.holder > b.holder ? 1 : 0));
}

/**
 * Autoridad total sobre el paciente: el jefe del hogar y el consejo de la aldea, combinados como
 * "al menos una manda". Sin consejo es idéntica a `householdAuthority`.
 */
export function villageAuthority(
  truth: ReadonlyWorldTruth,
  patient: AgentId,
  pathogen: string,
  o: CouncilAuthorityOptions = {},
): number {
  const belief = contagionBeliefOf(truth, pathogen, o);
  const sources: AuthoritySource[] = [];
  const head = householdHead(truth, patient, o);
  if (head !== undefined && head !== patient) sources.push({ holder: head, strength: belief });
  // Quien es jefe del hogar y además consejero cuenta una sola vez, con la mayor de sus fuerzas.
  for (const s of councilSources(truth, patient, pathogen, o)) {
    const dup = sources.findIndex((x) => x.holder === s.holder);
    if (dup < 0) sources.push(s);
    else if (s.strength > (sources[dup] as AuthoritySource).strength) sources[dup] = s;
  }
  return combineAuthorities(truth, patient, sources);
}
