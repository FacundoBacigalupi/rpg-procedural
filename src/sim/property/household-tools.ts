// Las cosas de cada casa (play-refs-objects-source-tools): el cuchillo, la olla, la canasta y las
// herramientas del campo como objetos con identidad, sembrados al empezar la vida en el cuarto que
// les toca. Cada casa las hace o junta cuando se levanta: un evento por hogar causado por el de
// construcción, y cada objeto nace de ese evento. Las tiene el hogar (`ITEM_HOLD.possession`); los
// derechos formales quedan para property. Sin contenido no crea nada.

import {
  type BuildingId,
  contentId,
  defineContent,
  type EventId,
  type EventLog,
  type HolderRef,
  type IdAllocator,
  type SettlementId,
  type SpaceKey,
  type Tick,
  z,
} from "../../core/index.ts";
import { BUILDING } from "../settlements/index.ts";
import { ENTITY, houseKey, LOCATION, type WorldTruth } from "../world/index.ts";
import { ITEM_HOLD, ITEM_LOOK } from "./item-state.ts";

export const HouseholdToolDef = z.strictObject({
  id: contentId,
  name: z.string().min(1),
  /** Lo que se ve (perception §3): claves que pone en palabras quien lo nombra. */
  shape: z.string().min(1),
  material: z.string().min(1).optional(),
  size: z.enum(["small", "medium", "large"]),
  /** El cuarto de la casa donde queda (`main`, `store`…); si la casa no lo tiene, el principal. */
  room: z.string().min(1),
  /** Desde cuántos miembros lo tiene un hogar (las herramientas del campo, en los grandes). */
  minMembers: z.number().int().min(1).optional(),
});
export type HouseholdToolDef = z.infer<typeof HouseholdToolDef>;
export const HOUSEHOLD_TOOLS = defineContent("household-tools", HouseholdToolDef);

export interface SeedToolsInput {
  readonly settlement: SettlementId;
  readonly tools: readonly HouseholdToolDef[];
  /** Cuántos viven en cada hogar (los que no están no tienen casa que equipar). */
  readonly members: ReadonlyMap<string, number>;
}

/** Siembra las cosas de cada casa viva del asentamiento. Devuelve cuántos objetos creó. */
export function seedHouseholdTools(
  truth: WorldTruth,
  ids: IdAllocator,
  log: EventLog,
  input: SeedToolsInput,
): number {
  if (input.tools.length === 0) return 0;
  const tools = [...input.tools].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let made = 0;
  for (const id of [...truth.ids(BUILDING)].sort() as BuildingId[]) {
    const b = truth.get(BUILDING, id);
    const household = b?.household;
    if (!b || household === undefined || b.settlement !== input.settlement) continue;
    if (truth.get(ENTITY, id)?.endedAt !== undefined) continue;
    const members = input.members.get(household) ?? 0;
    if (members === 0) continue;
    const kept = tools.filter((t) => (t.minMembers ?? 1) <= members);
    if (kept.length === 0) continue;
    const at: Tick = truth.get(ENTITY, id)?.createdAt ?? 0;
    const home = houseKey(household);
    const keys = new Set(b.graph.spaces.map((s) => s.key));
    const event: EventId = ids.next("event");
    log.append({
      id: event,
      tick: at,
      kind: "settlement.tools_made",
      data: { building: id, household, tools: kept.map((t) => t.id) },
      causes: [{ kind: "event", event: b.builtBy }],
      actors: [],
      place: { kind: "settlement", settlement: input.settlement },
      emissions: null,
      resolution: "history",
    });
    for (const t of kept) {
      const item = ids.next("item");
      const room = `${home}/${t.room}` as SpaceKey;
      const space = t.room !== "main" && keys.has(room) ? room : home;
      truth.set(ENTITY, item, { id: item, originEventId: event, createdAt: at });
      truth.set(ITEM_LOOK, item, {
        shape: t.shape,
        size: t.size,
        ...(t.material === undefined ? {} : { material: t.material }),
      });
      truth.set(LOCATION, item, { hex: b.hex, space });
      truth.set(ITEM_HOLD, item, { possession: household as unknown as HolderRef, rights: [] });
      made++;
    }
  }
  return made;
}
