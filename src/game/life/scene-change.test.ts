import { describe, expect, it } from "vitest";
import { type EntityRef, makeId } from "../../core/index.ts";
import type { Percept } from "../../sim/index.ts";
import { sceneChange } from "./view.ts";

const player = makeId("agent", 1);
const field = (value: unknown) => ({ value, confidence: 0.95, mistaken: false });

function seen(
  id: string,
  source: EntityRef,
  over: Partial<Pick<Percept, "channels" | "detail">> = {},
): Percept {
  return {
    id,
    observer: player,
    sourceEntityId: source,
    tick: 1,
    channels: ["sight"],
    detail: "clear",
    fields: { presence: field(true) },
    ...over,
  };
}

const a = makeId("agent", 2);
const b = makeId("agent", 3);
const c = makeId("agent", 4);

describe("sceneChange", () => {
  it("quien está y antes no apareció; quien estaba y ya no, se dejó de ver", () => {
    const r = sceneChange([seen("a1", a), seen("b1", b)], [seen("a2", a), seen("c2", c)]);
    expect([...r.arrived]).toEqual(["c2"]);
    expect(r.gone.map((p) => p.id)).toEqual(["b1"]);
  });

  it("oírlo alcanza para no darlo por ido, y una sombra no es una llegada", () => {
    const r = sceneChange(
      [seen("a1", a), seen("b1", b)],
      [seen("a2", a, { channels: ["sound"] }), seen("b2", b, { detail: "vague" })],
    );
    expect(r.gone).toEqual([]);
    expect([...r.arrived]).toEqual([]);
  });

  it("quien antes solo se oía y ahora se ve, aparece; uno solo por persona al irse", () => {
    const r = sceneChange(
      [seen("a1", a, { channels: ["sound"] }), seen("b1", b), seen("b1b", b)],
      [seen("a2", a)],
    );
    expect([...r.arrived]).toEqual(["a2"]);
    expect(r.gone.map((p) => p.id)).toEqual(["b1"]);
  });
});
