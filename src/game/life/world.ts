// La vida en memoria: la verdad, el registro, el ledger y el scheduler con los procesos de la
// Fase 1, más lo derivado del seed y del contenido que no se guarda (mapa, espacios, catálogos).

import type {
  AgentId,
  EventLog,
  IdAllocator,
  Ledger,
  PlaceRef,
  PlanetClock,
  Seed,
  Tick,
} from "../../core/index.ts";
import { makeId, Rng } from "../../core/index.ts";
import {
  type ActionCatalog,
  type BodyPlanDef,
  bodyProcess,
  ENTITY,
  type FoodDef,
  LOCATION,
  type LocalMap,
  type ReadonlyWorldTruth,
  Scheduler,
  type SchedulerState,
  type SkillCatalog,
  type SpaceGraph,
  type Trait,
  table,
  type WorldTruth,
} from "../../sim/index.ts";
import { actProcess } from "./act.ts";

/** El personaje del jugador: el agente que el usuario maneja (player-loop §1). */
export const PLAYER = table<{ readonly since: Tick }>("player");

export interface LifeWorld {
  readonly seed: Seed;
  readonly clock: PlanetClock;
  readonly truth: WorldTruth;
  readonly ids: IdAllocator;
  readonly log: EventLog;
  readonly ledger: Ledger;
  readonly map: LocalMap;
  readonly spaces: SpaceGraph;
  readonly catalog: ActionCatalog;
  readonly skills: SkillCatalog;
  readonly traits: readonly Trait[];
  readonly plans: readonly BodyPlanDef[];
  readonly foods: readonly FoodDef[];
  readonly scheduler: Scheduler;
  readonly player: AgentId;
}

export type LifeParts = Omit<LifeWorld, "scheduler" | "player">;

export function living(truth: ReadonlyWorldTruth): AgentId[] {
  return truth
    .ids(ENTITY)
    .filter(
      (id): id is AgentId =>
        id.startsWith("agent:") && truth.get(ENTITY, id)?.endedAt === undefined,
    );
}

/** El lugar de un evento de alguien: la aldea si está en su hex, si no la celda. */
function placeOf(parts: LifeParts, village: PlaceRef) {
  return (truth: ReadonlyWorldTruth, who: AgentId): PlaceRef => {
    const at = truth.get(LOCATION, who);
    return at && at.space !== undefined ? village : { kind: "cell", cell: parts.map.cell };
  };
}

/** El scheduler de la vida, nuevo (en `now`) o retomado de un estado guardado. */
export function lifeWorld(
  parts: LifeParts,
  player: AgentId,
  village: PlaceRef,
  start: SchedulerState,
): LifeWorld {
  const scheduler = new Scheduler(
    {
      rng: Rng.root(parts.seed),
      clock: parts.clock,
      truth: parts.truth,
      ids: parts.ids,
      log: parts.log,
      ledger: parts.ledger,
      processes: [
        bodyProcess({ plans: parts.plans, placeOf: placeOf(parts, village) }),
        actProcess({
          map: parts.map,
          spaces: parts.spaces,
          catalog: parts.catalog,
          skills: parts.skills,
          traits: parts.traits,
          bodyPlans: parts.plans,
          foods: parts.foods,
          clock: parts.clock,
        }),
      ],
      resolution: "local",
      scopes: (kind, t) => (kind === "agent" ? living(t) : []),
    },
    start,
  );
  return { ...parts, scheduler, player };
}

export { makeId };
