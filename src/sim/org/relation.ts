// Relaciones entre organizaciones (organizations §10, novel4-rival-sect-relation): lo que una
// organización siente y cree de otra, asimétrico (la de `from` hacia `to`). El estado declarado
// (`formal`: hoy solo `rival`), el sentimiento agregado de quienes deciden, la fuerza que `from`
// le cree a `to` (una creencia, con error: puede subestimarla o sobreestimarla), las ofensas que
// guarda (eventos) y la historia de lo que la movió. Toda relación nace de un evento.
//
// Puro: sin IO. Solo la siembra la escribe por ahora; las ofensas llegan con novel4-grievance.

import type { EventId } from "../../core/index.ts";
import { table } from "../world/index.ts";

/** Estados declarados entre organizaciones (se abren con tratados y guerras más adelante). */
export type OrgStance = "rival";

/** El sentimiento de una organización hacia otra: lo que agregan sus decisores. */
export interface OrgSentiment {
  /** 0-1: cuánto confía en su palabra. */
  readonly trust: number;
  /** 0-1: cuánto la respeta. */
  readonly respect: number;
  /** 0-1: cuánto la teme. */
  readonly fear: number;
  /** 0-1: cuánto rencor le guarda. */
  readonly resentment: number;
}

/** La fuerza de una organización de cultivadores, como cuentas a la vista. */
export interface OrgStrength {
  readonly elders: number;
  readonly disciples: number;
  /** El umbral más alto que cruzó alguno de los suyos. */
  readonly topStage: number;
}

export interface OrgTie {
  readonly formal: readonly OrgStance[];
  readonly sentiment: OrgSentiment;
  /** Lo que `from` cree de la fuerza de `to`, no la verdad. */
  readonly believedStrength: OrgStrength;
  /** Ofensas que guarda: muertes, humillaciones, robos (eventos). */
  readonly grievances: readonly EventId[];
  readonly originEventId: EventId;
  /** Lo que la movió, del más viejo al más nuevo. */
  readonly history: readonly EventId[];
}

/** Lo que una organización siente y cree de cada otra (clave: id de la otra). */
export interface OrgRelations {
  readonly toward: Readonly<Record<string, OrgTie>>;
}

/** Las relaciones de cada organización hacia las demás (clave: la organización `from`). */
export const ORG_RELATION = table<OrgRelations>("org.relation");

/** Lo que `from` siente y cree de `to`, si tienen relación. */
export function orgTie(relations: OrgRelations | undefined, to: string): OrgTie | undefined {
  return relations?.toward[to];
}

/** Si `from` tiene a `to` por rival declarada. */
export function isRival(relations: OrgRelations | undefined, to: string): boolean {
  return orgTie(relations, to)?.formal.includes("rival") === true;
}
