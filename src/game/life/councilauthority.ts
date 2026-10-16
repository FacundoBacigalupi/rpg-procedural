// Autoridad de aldea (organizations §11, body-health §6): lo que el consejo le impone al paciente
// frente a un contagio. Cada miembro vivo del consejo del asentamiento del paciente es una fuente
// de autoridad: pesa lo que cree que se pega por su rango (el cabeza más que un anciano); después
// `combineAuthorities` la pondera por el respeto que el paciente le tiene a cada uno (RELATIONS).
// Puro: solo lee la verdad. Pesa el respeto personal (RELATIONS `respect`) y, desde 5b, la lealtad
// del paciente a la organización (ORG_LOYALTY), que sobrevive al cambio de cabeza.

import type { AgentId } from "../../core/index.ts";
import {
  activeMembers,
  type ForumStanding,
  HOUSEHOLD,
  loyaltyOf,
  NO_STANDING,
  ORG,
  ORG_LOYALTY,
  PERSON,
  type ReadonlyWorldTruth,
} from "../../sim/index.ts";
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
    // La lealtad del paciente a la organización (5b) es de ella, no de quien la encabeza.
    const loyalty = loyaltyOf(truth.get(ORG_LOYALTY, id), patient);
    for (const m of activeMembers(org)) {
      out.push({
        holder: m.agent,
        strength: belief * (m.rank === "head" ? head : elder),
        ...(loyalty > 0 ? { loyalty } : {}),
      });
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
    else {
      const prev = sources[dup] as AuthoritySource;
      const loyalty = Math.max(prev.loyalty ?? 0, s.loyalty ?? 0);
      sources[dup] = {
        holder: s.holder,
        strength: Math.max(prev.strength, s.strength),
        ...(loyalty > 0 ? { loyalty } : {}),
      };
    }
  }
  return combineAuthorities(truth, patient, sources);
}

/** Clave de "creencia" fija para pedir la autoridad del consejo fuera de un contagio. */
const ANY = "*";

/**
 * Lo que el consejo de la aldea de `subject` pesa sobre él como foro de una denuncia (law §4,
 * Consejo de aldea 5d): la autoridad que le reconoce (respeto creído en RELATIONS hacia cada
 * miembro, más la lealtad a la organización; la creencia de contagio fija en 1 porque aquí no es
 * un contagio) y la mayor lealtad que guarda a un consejo activo de su asentamiento. Lee solo lo
 * creído y lo registrado (RELATIONS, ORG_LOYALTY), ningún hecho. Sin consejo: `NO_STANDING`.
 */
export function councilStanding(
  truth: ReadonlyWorldTruth,
  subject: AgentId,
  o: CouncilAuthorityOptions = {},
): ForumStanding {
  const whole = { ...o, contagionBelief: { ...o.contagionBelief, [ANY]: 1 } };
  const sources = councilSources(truth, subject, ANY, whole);
  if (sources.length === 0) return NO_STANDING;
  const home = truth.get(PERSON, subject)?.household;
  const settlement = home === undefined ? undefined : truth.get(HOUSEHOLD, home)?.settlement;
  let loyalty = 0;
  for (const id of [...truth.ids(ORG)].sort()) {
    const org = truth.get(ORG, id);
    if (org?.status !== "active" || org.settlement !== settlement) continue;
    loyalty = Math.max(loyalty, loyaltyOf(truth.get(ORG_LOYALTY, id), subject));
  }
  return { authority: combineAuthorities(truth, subject, sources), loyalty };
}
