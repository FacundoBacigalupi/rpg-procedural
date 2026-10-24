// Lo que se le cae a alguien que huye o cae (combat §huir, play-refs-objects-source-flee): los
// objetos con identidad que lleva y que abultan quedan sueltos donde pasó, con la posesión en el
// lugar y su propia LOCATION. Lo chico (un cuchillo, un cuenco) sigue encima: va en la faja o en
// el bolsillo. Los derechos no se tocan: sigue siendo de quien era.

import type { AgentId, EventId, HolderRef, ItemId } from "../../core/index.ts";
import { type StateChange, setComponent } from "../scheduler/index.ts";
import { ENTITY, LOCATION, type ReadonlyWorldTruth } from "../world/index.ts";
import {
  ITEM_HOLD,
  ITEM_LOOK,
  type ItemSize,
  itemEndpoint,
  itemSnapshot,
  itemTransferChanges,
} from "./item-state.ts";
import { transferItem } from "./item-transfer.ts";

/** Los tamaños que se pierden al correr o al caer: lo que se lleva en la mano o a cuestas. */
export const SHED_SIZES: readonly ItemSize[] = ["medium", "large"];

/**
 * Los cambios para que `who` suelte en `at` lo que lleva y abulta, causados por `cause`. Sin
 * `LOCATION` de `who` no hay dónde dejarlo y no se suelta nada.
 */
export function shedCarried(
  truth: ReadonlyWorldTruth,
  who: AgentId,
  at: HolderRef,
  cause: EventId,
): StateChange[] {
  const where = truth.get(LOCATION, who);
  if (where === undefined) return [];
  const changes: StateChange[] = [];
  for (const id of [...truth.ids(ITEM_HOLD)].sort()) {
    const item = id as ItemId;
    if (truth.get(ITEM_HOLD, item)?.possession !== who) continue;
    const look = truth.get(ITEM_LOOK, item);
    if (!look || !SHED_SIZES.includes(look.size)) continue;
    if (truth.get(ENTITY, item)?.endedAt !== undefined) continue;
    const moved = itemTransferChanges(
      truth,
      transferItem({
        item,
        snapshot: itemSnapshot(truth, item),
        from: itemEndpoint(truth, who, true),
        to: itemEndpoint(truth, at, true),
        operation: "give",
        cause,
      }),
    );
    if (moved.length > 0) changes.push(...moved, setComponent(LOCATION, item, where));
  }
  return changes;
}
