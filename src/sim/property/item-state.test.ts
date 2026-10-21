import { describe, expect, it } from "vitest";
import { makeId } from "../../core/index.ts";
import { ENTITY, LOCATION, WorldTruth } from "../world/index.ts";
import {
  ITEM_HOLD,
  itemEndpoint,
  itemHex,
  itemSnapshot,
  itemTransferChanges,
} from "./item-state.ts";
import { transferItem } from "./item-transfer.ts";

const ev = makeId("event", 1);
const sword = makeId("item", 1);
const a = makeId("agent", 1);
const b = makeId("agent", 2);

function world() {
  const t = new WorldTruth();
  for (const id of [sword, a, b]) t.set(ENTITY, id, { id, createdAt: 0, originEventId: ev });
  t.set(LOCATION, sword, { hex: 4 });
  t.set(LOCATION, a, { hex: 4 });
  t.set(LOCATION, b, { hex: 9 });
  return t;
}

describe("estado de ítems existentes", () => {
  it("el snapshot sale de ENTITY; sin ITEM_HOLD no hay poseedor ni derechos; lo que no existe no tiene", () => {
    const t = world();
    expect(itemSnapshot(t, sword)).toMatchObject({ possession: null, rights: [] });
    expect(itemSnapshot(t, makeId("item", 7))).toBeUndefined();
    expect(t.get(ITEM_HOLD, sword)).toBeUndefined(); // leer no siembra nada
  });

  it("una toma aceptada cambia posesión, borra la LOCATION propia y la ubicación sigue al portador", () => {
    const t = world();
    const r = transferItem({
      item: sword,
      snapshot: itemSnapshot(t, sword),
      from: itemEndpoint(t, null, true),
      to: itemEndpoint(t, a, true),
      operation: "take",
      cause: ev,
    });
    const changes = itemTransferChanges(t, r);
    expect(changes.map((c) => [c.op, c.table])).toEqual([
      ["set", "property.item"],
      ["delete", "space.location"],
    ]);
    for (const c of changes) {
      if (c.op === "set") t.setRaw(c.table, c.id, c.value);
      else t.deleteRaw(c.table, c.id);
    }
    expect(itemSnapshot(t, sword)?.possession).toBe(a);
    expect(itemHex(t, sword)).toBe(4);
    t.set(LOCATION, a, { hex: 5 });
    expect(itemHex(t, sword)).toBe(5);
  });

  it("un rechazo no propone cambios y un destino muerto aparece con endedAt", () => {
    const t = world();
    t.set(ENTITY, b, { id: b, createdAt: 0, originEventId: ev, endedAt: 10 });
    const r = transferItem({
      item: sword,
      snapshot: itemSnapshot(t, sword),
      from: itemEndpoint(t, null, true),
      to: itemEndpoint(t, b, true),
      operation: "give",
      cause: ev,
    });
    expect(r).toEqual({ accepted: false, reason: "unavailable_destination" });
    expect(itemTransferChanges(t, r)).toEqual([]);
  });
});
