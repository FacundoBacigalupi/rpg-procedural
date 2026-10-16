// De dónde es cada persona y qué lenguas habla (language §5 y §12, culture §4), la parte mínima de
// `npc-b2b4c2b3a`: una fila opt-in por persona con su asentamiento de origen y sus lenguas con
// nivel (0-1). Quien no tiene fila es de la aldea y habla la lengua de la aldea entera (lo de
// siempre), así que sin filas nada cambia. El acento nativo sale del acento sembrado del
// asentamiento de origen (`COMMUNITY_ACCENT`); la lengua nativa, de esa misma fila.

import type { AgentId, SettlementId } from "../../core/index.ts";
import {
  COMMUNITY_ACCENT,
  type ReadonlyWorldTruth,
  table,
  type WorldTruth,
} from "../../sim/index.ts";
import { villageOf } from "./taboos.ts";

export interface SpokenLanguage {
  readonly language: string;
  /** Cuánto la domina (0-1): 1 es nativa. */
  readonly level: number;
}

export interface PersonOrigin {
  /** El asentamiento donde se crió (su acento nativo es el de ese lugar). */
  readonly origin: SettlementId;
  /** Las lenguas que habla además de la nativa, con nivel (la nativa se deduce del origen). */
  readonly learned: readonly SpokenLanguage[];
}

export const PERSON_ORIGIN = table<PersonOrigin>("life.person_origin");

/** Anota el origen y las lenguas aprendidas de una persona (viajeros, migrantes, el personaje). */
export function setPersonOrigin(truth: WorldTruth, who: AgentId, origin: PersonOrigin): void {
  truth.set(PERSON_ORIGIN, who, origin);
}

/** El asentamiento de origen: el de su fila o, sin fila, la aldea. */
export function originOf(truth: ReadonlyWorldTruth, who: AgentId): SettlementId | undefined {
  return truth.get(PERSON_ORIGIN, who)?.origin ?? villageOf(truth);
}

/** Las lenguas que habla con nivel: la nativa del origen (1) y las aprendidas. */
export function languagesOf(truth: ReadonlyWorldTruth, who: AgentId): readonly SpokenLanguage[] {
  const origin = originOf(truth, who);
  const row = origin === undefined ? undefined : truth.get(COMMUNITY_ACCENT, origin);
  const own: SpokenLanguage[] = row ? [{ language: row.language, level: 1 }] : [];
  return [...own, ...(truth.get(PERSON_ORIGIN, who)?.learned ?? [])];
}

/** Cuánto domina `who` una lengua (0 si no la habla; el mayor nivel si figura dos veces). */
export function levelIn(truth: ReadonlyWorldTruth, who: AgentId, language: string): number {
  return languagesOf(truth, who).reduce(
    (best, l) => (l.language === language ? Math.max(best, l.level) : best),
    0,
  );
}
