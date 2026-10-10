// Paciente y vínculos reales (body-health §6): de dónde salen `authorityOf` y `trustOf` de
// `patientDecides` cuando se pide `realBonds`. La autoridad es el jefe del hogar (el vivo más
// viejo, desempate por id) y lo que él cree que se pega, ponderada por cuánto lo respeta el
// paciente; la confianza es la que el paciente tiene de verdad en el sanador (RELATIONS), con la
// fama que cree como respaldo si no hay trato. Puro: solo lee la verdad.

import type { AgentId } from "../../core/index.ts";
import { ENTITY, HOUSEHOLD, PERSON, RELATIONS, type ReadonlyWorldTruth } from "../../sim/index.ts";
import { renownBelieved } from "./moldgossip.ts";

export interface PatientBondsOptions {
  /** Condición a 0-1: lo que la cultura cree que se pega (misma tabla que `contagionBelief`). */
  readonly contagionBelief?: Readonly<Record<string, number>>;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** El jefe del hogar del paciente: el vivo más viejo; `undefined` si no hay hogar. */
export function householdHead(truth: ReadonlyWorldTruth, who: AgentId): AgentId | undefined {
  const home = truth.get(PERSON, who)?.household;
  if (home === undefined) return undefined;
  let best: { id: AgentId; born: number } | undefined;
  for (const m of truth.get(HOUSEHOLD, home)?.members ?? []) {
    if (truth.get(ENTITY, m)?.endedAt !== undefined) continue;
    const p = truth.get(PERSON, m);
    if (!p) continue;
    if (!best || p.born < best.born || (p.born === best.born && m < best.id)) {
      best = { id: m, born: p.born };
    }
  }
  return best?.id;
}

/**
 * Autoridad que el hogar le impone al paciente frente a `pathogen`: lo que el jefe cree que se
 * pega por lo que el paciente lo respeta (0 si el paciente es el jefe: decide solo). Sin
 * respeto positivo no manda.
 */
export function householdAuthority(
  truth: ReadonlyWorldTruth,
  patient: AgentId,
  pathogen: string,
  o: PatientBondsOptions,
): number {
  const head = householdHead(truth, patient);
  if (head === undefined || head === patient) return 0;
  // Se lee tal cual está guardada (los procesos no traen la hora a este callback).
  const respect = truth.get(RELATIONS, patient)?.toward[head as string]?.dims.respect ?? 0;
  return clamp01(clamp01(respect) * (o.contagionBelief?.[pathogen] ?? 0.5));
}

/**
 * Confianza del paciente en el sanador: la relación real (trust de -1..1 a 0..1, con un poco de
 * afecto) y, si además cree una fama, el promedio con ella. Sin trato ni fama, `undefined`
 * (queda el prior).
 */
export function realTrust(
  truth: ReadonlyWorldTruth,
  patient: AgentId,
  healer: AgentId,
): number | undefined {
  const fame = renownBelieved(truth, patient, healer);
  const known = truth.get(RELATIONS, patient)?.toward[healer as string];
  if (!known) return fame;
  const d = known.dims;
  const rel = clamp01(0.5 + 0.4 * d.trust + 0.1 * d.affection);
  return fame === undefined ? rel : (rel + fame) / 2;
}
