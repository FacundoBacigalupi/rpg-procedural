// El oficio de adivino de calle como rol de una persona (divination §8, Fase 2): quién lo ejerce,
// con qué método y cómo es (halago, perspicacia, escuela), y qué barrio le cree (fama con fallos
// recordados a medias). Elegir quién cae en el oficio es puro: sale de edad y temperamento, nunca
// de la verdad del futuro. El proceso del juego lo siembra y atiende las consultas.

import type { AgentId, Tick } from "../../core/index.ts";
import { table } from "../world/index.ts";
import type { DivinationMethodDef, Diviner, DivinerRecord } from "./street.ts";

/** El rol: se guarda en la entidad de la persona que lo ejerce. */
export interface DivinerRole extends Diviner {
  /** Id del método de `content/divination` con que consulta. */
  readonly method: string;
  readonly record: DivinerRecord;
  /** Desde cuándo ejerce. */
  readonly since: Tick;
}

export const DIVINER_ROLE = table<DivinerRole>("divination.diviner");

/** Un adivino de calle cada tantos habitantes (mínimo uno en un lugar de ese tamaño). */
export const PEOPLE_PER_DIVINER = 60;
/** Habitantes mínimos para que haya quien viva de leer al resto. */
export const MIN_PEOPLE_FOR_DIVINER = 20;
/** Edad desde la que se ejerce el oficio (años). */
export const DIVINER_MIN_AGE = 30;

export interface DiviningCandidate {
  readonly id: AgentId;
  readonly ageYears: number;
  /** Ejes del temperamento en -1..1. */
  readonly sociability: number;
  readonly curiosity: number;
  readonly warmth: number;
  readonly boldness: number;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const round = (x: number) => Math.round(x * 1e6) / 1e6;

/** Cuántos adivinos de calle sostiene un lugar con tanta gente. */
export function divinerSlots(people: number): number {
  return people < MIN_PEOPLE_FOR_DIVINER ? 0 : Math.max(1, Math.floor(people / PEOPLE_PER_DIVINER));
}

/**
 * Quién se hace adivino: gente hecha (la edad pesa, con tope), sociable, curiosa y audaz para
 * plantarse frente a los demás. Desempata el id. Devuelve hasta `count` ids.
 */
export function pickDiviners(candidates: readonly DiviningCandidate[], count: number): AgentId[] {
  const score = (c: DiviningCandidate) =>
    Math.min(c.ageYears, 60) / 60 + 0.5 * c.sociability + 0.4 * c.curiosity + 0.3 * c.boldness;
  return candidates
    .filter((c) => c.ageYears >= DIVINER_MIN_AGE)
    .sort((a, b) => score(b) - score(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, Math.max(0, count))
    .map((c) => c.id);
}

/** Cómo es como adivino: el cálido halaga, el curioso lee mejor, el audaz se inclina a ver grandeza. */
export function roleOf(
  c: DiviningCandidate,
  method: DivinationMethodDef,
  since: Tick,
): DivinerRole {
  return {
    id: c.id,
    method: method.id,
    flattery: round(clamp01(0.5 + 0.4 * c.warmth + 0.2 * c.sociability)),
    insight: round(clamp01(0.45 + 0.4 * c.curiosity + (0.1 * Math.min(c.ageYears, 60)) / 60)),
    school: round(Math.max(-1, Math.min(1, 0.6 * c.boldness - 0.3 * c.warmth))),
    record: { hits: 0, misses: 0 },
    since,
  };
}
