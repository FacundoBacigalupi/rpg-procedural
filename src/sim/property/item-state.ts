// Estado de objetos con identidad (property §12, `perfil2-item-claims-take-state`). Solo
// proyecta lo que ya existe: la posesión y los derechos viven en `ITEM_HOLD`, la ubicación de un
// objeto portado se deriva de su portador y la de uno suelto es su propia LOCATION. Nada crea
// objetos ni siembra componentes: un ítem sin `ITEM_HOLD` es un ítem sin poseedor ni derechos.
import type { EntityRef, HolderRef, ItemId } from "../../core/index.ts";
import { deleteComponent, type StateChange, setComponent } from "../scheduler/index.ts";
import { ENTITY, LOCATION, type ReadonlyWorldTruth, table } from "../world/index.ts";
import type {
  ItemRight,
  ItemTransferEndpoint,
  ItemTransferResult,
  ItemTransferSnapshot,
} from "./item-transfer.ts";

/** Posesión física (un poseedor o ninguno) y haces de derechos de un ítem existente. */
export interface ItemHold {
  readonly possession: HolderRef | null;
  readonly rights: readonly ItemRight[];
}

export const ITEM_HOLD = table<ItemHold>("property.item");

const isItem = (id: string): id is ItemId => id.startsWith("item:");

/** Snapshot desde ENTITY + ITEM_HOLD; `undefined` si el ítem no existe como entidad. */
export function itemSnapshot(
  truth: ReadonlyWorldTruth,
  item: ItemId,
): ItemTransferSnapshot | undefined {
  const entity = truth.get(ENTITY, item);
  if (!entity || !isItem(item)) return undefined;
  const hold = truth.get(ITEM_HOLD, item);
  return {
    entity: entity as ItemTransferSnapshot["entity"],
    possession: hold?.possession ?? null,
    rights: hold?.rights ?? [],
  };
}

/** Hex del ítem: el del portador si lo lleva un agente; si no, su propia LOCATION. */
export function itemHex(truth: ReadonlyWorldTruth, item: ItemId): number | undefined {
  const holder = truth.get(ITEM_HOLD, item)?.possession;
  if (typeof holder === "string" && holder.startsWith("agent:")) {
    return truth.get(LOCATION, holder as EntityRef)?.hex;
  }
  return truth.get(LOCATION, item)?.hex;
}

/**
 * Disponibilidad física de un extremo. `reachable` la decide quien llama (distancia, espacio,
 * percepción); acá solo se toma lo que el mundo sabe de existencia y fin.
 */
export function itemEndpoint(
  truth: ReadonlyWorldTruth,
  holder: HolderRef | null,
  reachable: boolean,
): ItemTransferEndpoint {
  if (holder === null) return { holder, exists: true, reachable };
  if (typeof holder !== "string") return { holder, exists: true, reachable };
  const entity = truth.get(ENTITY, holder as EntityRef);
  return {
    holder,
    exists: entity !== undefined,
    reachable,
    ...(entity?.endedAt !== undefined ? { endedAt: entity.endedAt } : {}),
  };
}

/**
 * Cambios de una transferencia aceptada: nuevo `ITEM_HOLD` y, si ahora lo lleva un agente, se
 * borra la LOCATION propia (no quedan dos ubicaciones). Un rechazo no propone cambios.
 */
export function itemTransferChanges(
  truth: ReadonlyWorldTruth,
  result: ItemTransferResult,
): StateChange[] {
  if (!result.accepted) return [];
  const changes: StateChange[] = [
    setComponent(ITEM_HOLD, result.item, { possession: result.possession, rights: result.rights }),
  ];
  if (
    typeof result.possession === "string" &&
    result.possession.startsWith("agent:") &&
    truth.get(LOCATION, result.item) !== undefined
  ) {
    changes.push(deleteComponent(LOCATION, result.item));
  }
  return changes;
}
