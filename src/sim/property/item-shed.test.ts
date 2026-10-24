import { describe, expect, it } from "vitest";
import { type HolderRef, makeId } from "../../core/index.ts";
import type { StateChange } from "../scheduler/index.ts";
import { ENTITY, LOCATION, WorldTruth } from "../world/index.ts";
import { shedCarried } from "./item-shed.ts";
import { ITEM_HOLD, ITEM_LOOK, type ItemSize } from "./item-state.ts";

const ev = makeId("event", 1);
const fight = makeId("event", 2);
const a = makeId("agent", 1);
const b = makeId("agent", 2);
const here: HolderRef = { kind: "cell", cell: makeId("cell", 4) };

function world(items: readonly [number, ItemSize, string][]) {
  const t = new WorldTruth();
  for (const id of [a, b]) t.set(ENTITY, id, { id, createdAt: 0, originEventId: ev });
  t.set(LOCATION, a, { hex: 4, space: "yard" });
  for (const [n, size, holder] of items) {
    const id = makeId("item", n);
    t.set(ENTITY, id, { id, createdAt: 0, originEventId: ev });
    t.set(ITEM_LOOK, id, { shape: "pot", size });
    t.set(ITEM_HOLD, id, {
      possession: holder as HolderRef,
      rights: [],
    });
  }
  return t;
}

function apply(t: WorldTruth, changes: readonly StateChange[]) {
  for (const c of changes) {
    if (c.op === "set") t.setRaw(c.table, c.id, c.value);
    else t.deleteRaw(c.table, c.id);
  }
}

describe("lo que se cae al huir o caer (play-refs-objects-source-flee)", () => {
  it("lo que abulta queda en el lugar con la LOCATION del portador; lo chico sigue encima", () => {
    const t = world([
      [1, "small", a],
      [2, "medium", a],
      [3, "large", a],
      [4, "medium", b],
    ]);
    apply(t, shedCarried(t, a, here, fight));
    expect(t.get(ITEM_HOLD, makeId("item", 1))?.possession).toBe(a);
    for (const n of [2, 3]) {
      const id = makeId("item", n);
      expect(t.get(ITEM_HOLD, id)?.possession).toEqual(here);
      expect(t.get(LOCATION, id)).toEqual({ hex: 4, space: "yard" });
    }
    expect(t.get(ITEM_HOLD, makeId("item", 4))?.possession).toBe(b);
  });

  it("sin LOCATION del portador, o con el objeto ya terminado, no se suelta nada", () => {
    const t = world([[2, "medium", b]]);
    expect(shedCarried(t, b, here, fight)).toEqual([]);
    const u = world([[2, "medium", a]]);
    u.set(ENTITY, makeId("item", 2), {
      id: makeId("item", 2),
      createdAt: 0,
      originEventId: ev,
      endedAt: 5,
    });
    expect(shedCarried(u, a, here, fight)).toEqual([]);
  });

  it("es determinista: el mismo estado da los mismos cambios en el mismo orden", () => {
    const items: [number, ItemSize, string][] = [
      [9, "medium", a],
      [3, "large", a],
      [5, "medium", a],
    ];
    expect(shedCarried(world(items), a, here, fight)).toEqual(
      shedCarried(world([...items].reverse()), a, here, fight),
    );
  });
});
