// Las tablas de family en la verdad (ARCHITECTURE §4.4: `sim/family` es dueño de `Genome` y
// `Household`) y la siembra de la aldea de la pre-corrida en un `WorldTruth`.

import type { AgentId, HouseholdId, SettlementId, Tick } from "../../core/index.ts";
import { ENTITY, table, type WorldTruth } from "../world/index.ts";
import type { Genome, Innate, Sex } from "./genome.ts";
import type { VillagePopulation } from "./village.ts";

/** Lo civil de una persona: sexo, nacimiento, padres biológicos, hogar y cónyuge. */
export interface PersonRecord {
  readonly sex: Sex;
  readonly born: Tick;
  readonly mother: AgentId | null;
  readonly father: AgentId | null;
  readonly household: HouseholdId;
  readonly spouse: AgentId | null;
}

export interface HouseholdRecord {
  readonly settlement: SettlementId;
  readonly members: readonly AgentId[];
}

export const PERSON = table<PersonRecord>("family.person");
/** Verdad oculta: nadie la lee fuera de family (family-lineage §1). */
export const GENOME = table<Genome>("family.genome");
export const INNATE = table<Innate>("family.innate");
export const HOUSEHOLD = table<HouseholdRecord>("family.household");

/** Escribe la aldea (personas, hogares y el asentamiento) en la verdad. Solo al sembrar. */
export function seedVillage(truth: WorldTruth, pop: VillagePopulation): void {
  truth.set(ENTITY, pop.settlement, {
    id: pop.settlement,
    originEventId: pop.foundedEvent,
    createdAt: 0,
  });
  for (const h of pop.households) {
    truth.set(ENTITY, h.id, {
      id: h.id,
      originEventId: h.origin,
      createdAt: h.since,
      ...(h.end ? { endedAt: h.end.tick, endEventId: h.end.event } : {}),
    });
    truth.set(HOUSEHOLD, h.id, { settlement: pop.settlement, members: h.members });
  }
  for (const p of pop.people) {
    truth.set(ENTITY, p.id, {
      id: p.id,
      originEventId: p.origin,
      createdAt: p.since,
      ...(p.end ? { endedAt: p.end.tick, endEventId: p.end.event } : {}),
    });
    truth.set(PERSON, p.id, {
      sex: p.sex,
      born: p.born,
      mother: p.mother,
      father: p.father,
      household: p.household,
      spouse: p.spouse,
    });
    truth.set(GENOME, p.id, p.genome);
    truth.set(INNATE, p.id, p.innate);
  }
}
