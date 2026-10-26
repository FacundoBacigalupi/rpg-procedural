// La herramienta de la casa en la rutina de campo (perfil2-item-claims-item-demand-routine): quien sale
// de su casa al campo agarra la herramienta de trabajar la tierra que esté suelta ahí (azada, hoz:
// los `instruments` de `work`), cada hora de campo con ella rinde más y la gasta como en `toolFor`,
// y al volver a su casa la deja, otra vez del hogar.

import type { AgentId, EntityRef, HolderRef, ItemId, SpaceKey } from "../../core/index.ts";
import {
  type ActionDef,
  deleteComponent,
  ENTITY,
  type EventDraft,
  ITEM_HOLD,
  ITEM_LOOK,
  ITEM_WEAR,
  LOCATION,
  type Location,
  type ReadonlyWorldTruth,
  type StateChange,
  setComponent,
} from "../../sim/index.ts";
import { householdToolFor } from "./npc-tools.ts";

export const ROUTINE_TOOL_TAKEN = "routine.took_tool";
export const ROUTINE_TOOL_RETURNED = "routine.returned_tool";

export interface RoutineToolStep {
  readonly changes: StateChange[];
  readonly events: EventDraft[];
  /** Lo que multiplica la cosecha de esta hora (1 sin herramienta o gastada del todo). */
  readonly rate: number;
  /** La herramienta con la que trabaja esta hora, si hay. */
  readonly tool?: ItemId;
}

function inHome(space: SpaceKey | undefined, home: SpaceKey): boolean {
  return space !== undefined && (space === home || space.startsWith(`${home}/`));
}

/** La herramienta de campo que `me` lleva encima (la primera por id), si lleva alguna. */
function carriedTool(
  truth: ReadonlyWorldTruth,
  me: AgentId,
  shapes: readonly string[],
): ItemId | undefined {
  for (const item of [...truth.ids(ITEM_HOLD)].sort() as ItemId[]) {
    if (truth.get(ITEM_HOLD, item)?.possession !== me) continue;
    if (truth.get(ENTITY, item)?.endedAt !== undefined) continue;
    if (shapes.includes(truth.get(ITEM_LOOK, item)?.shape ?? "")) return item;
  }
  return undefined;
}

/**
 * El paso de herramienta de una hora de rutina (puro). En el campo (`atFields`): si no lleva una y
 * sale de un cuarto de su casa, agarra la suelta que sirva (`householdToolFor`); con una entera, la
 * hora rinde `1 + (rate - 1)·(1 - wear)` y la gasta `1 / hours`. Volviendo a su casa (`there` es un
 * cuarto de su casa) con una herramienta de campo encima, la deja ahí como del hogar.
 */
export function routineToolStep(input: {
  readonly truth: ReadonlyWorldTruth;
  readonly me: AgentId;
  readonly household: string;
  readonly home: SpaceKey;
  readonly here: Location | undefined;
  readonly there: Location | undefined;
  readonly atFields: boolean;
  /** Si la hora de campo trabaja la tierra (no en invierno ni de chico): si no, no la agarra ni gasta. */
  readonly working: boolean;
  readonly instruments: ActionDef["instruments"];
  readonly place: EventDraft["place"];
}): RoutineToolStep {
  const { truth, me, home, instruments } = input;
  const shapes = instruments.flatMap((t) => t.shapes);
  const changes: StateChange[] = [];
  const events: EventDraft[] = [];
  if (shapes.length === 0) return { changes, events, rate: 1 };
  let tool = carriedTool(truth, me, shapes);
  const cause = [{ kind: "state" as const, entity: me as EntityRef, key: "routine" }];
  if (input.atFields) {
    if (!input.working) return { changes, events, rate: 1 };
    if (tool === undefined && inHome(input.here?.space, home)) {
      const pick = householdToolFor(truth, me, shapes);
      const hold = pick === undefined ? undefined : truth.get(ITEM_HOLD, pick);
      if (pick !== undefined && hold !== undefined) {
        changes.push(
          setComponent(ITEM_HOLD, pick, { ...hold, possession: me as unknown as HolderRef }),
          deleteComponent(LOCATION, pick),
        );
        events.push({
          kind: ROUTINE_TOOL_TAKEN,
          actors: [me],
          place: input.place,
          data: { item: pick, shape: truth.get(ITEM_LOOK, pick)?.shape ?? "" },
          emissions: { sight: 0.2, sound: 0.05 },
          causes: cause,
        });
        tool = pick;
      }
    }
    if (tool === undefined) return { changes, events, rate: 1 };
    const shape = truth.get(ITEM_LOOK, tool)?.shape ?? "";
    const spec = instruments.find((t) => t.shapes.includes(shape));
    const wear = truth.get(ITEM_WEAR, tool)?.wear ?? 0;
    if (spec === undefined || wear >= 1) return { changes, events, rate: 1 };
    const worn = Math.min(1, Math.round((wear + 1 / spec.hours) * 1e6) / 1e6);
    changes.push(setComponent(ITEM_WEAR, tool, { wear: worn }));
    return { changes, events, rate: 1 + (spec.rate - 1) * (1 - wear), tool };
  }
  const there = input.there;
  if (tool !== undefined && there !== undefined && inHome(there.space, home)) {
    const hold = truth.get(ITEM_HOLD, tool);
    if (hold !== undefined) {
      changes.push(
        setComponent(ITEM_HOLD, tool, {
          ...hold,
          possession: input.household as unknown as HolderRef,
        }),
        setComponent(LOCATION, tool, there),
      );
      events.push({
        kind: ROUTINE_TOOL_RETURNED,
        actors: [me],
        place: input.place,
        data: { item: tool, shape: truth.get(ITEM_LOOK, tool)?.shape ?? "" },
        emissions: { sight: 0.1 },
        causes: cause,
      });
    }
  }
  return { changes, events, rate: 1 };
}
