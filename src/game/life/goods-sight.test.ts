import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import { goodUnit, houseKey, LOCATION, PERSON, type PlanNode } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { goodsInSight, missingGoodsNote } from "./goods-sight.ts";
import { Life } from "./life.ts";

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}
const content = loadContent(GAME_CONTENT_KINDS, sources("content"));

const take = (text: string, from = false): PlanNode => ({
  kind: "do",
  verb: "take",
  args: [{ role: "what", text }, ...(from ? [{ role: "from", entity: "agent:1" as never }] : [])],
  manner: [],
});

describe("bienes por descripción (play-refs-objects-goods)", () => {
  it("lo que nombra y no ve se dice antes del turno; lo que ve o no nombra pasa", () => {
    const life = Life.create(7, content, { frequency: 8 });
    const w = life.world;
    // En su casa: la despensa está a la vista.
    const household = w.truth.get(PERSON, w.player)?.household;
    const here = w.truth.get(LOCATION, w.player);
    if (!household || !here) throw new Error("sin casa");
    const house = w.spaces.spaces.find((s) => s.key === houseKey(household));
    if (!house) throw new Error("sin cuarto");
    w.truth.set(LOCATION, w.player, { hex: house.hex, space: house.key });
    const sight = goodsInSight(w);
    const home = sight.find((g) => g.where === "home");
    if (!home) throw new Error("despensa vacía");
    const name = w.goods.find((g) => goodUnit(g) === home.unit)?.name as string;
    expect(missingGoodsNote(w, take(`el ${name}`))).toBeUndefined();
    expect(missingGoodsNote(w, take(`el ${name} de la mesa`))).toBeUndefined();
    expect(missingGoodsNote(w, take("la olla"))).toBe("No ves ninguna olla acá.");
    expect(missingGoodsNote(w, take("un tambor"))).toBe("No ves ningún tambor acá.");
    expect(missingGoodsNote(w, take("ollas"))).toBe("No ves ollas acá.");
    // Sin nombrar un bien, o de una persona: no se corta.
    expect(missingGoodsNote(w, take("algo"))).toBeUndefined();
    expect(missingGoodsNote(w, take("lo que haya"))).toBeUndefined();
    expect(missingGoodsNote(w, take("la olla", true))).toBeUndefined();
    // En una secuencia también.
    expect(missingGoodsNote(w, { kind: "seq", steps: [take(`el ${name}`), take("la olla")] })).toBe(
      "No ves ninguna olla acá.",
    );
    // Fuera de casa la despensa no se ve.
    w.truth.set(LOCATION, w.player, here);
    if (here.space !== house.key) {
      expect(goodsInSight(w).some((g) => g.where === "home")).toBe(false);
    }
  });
});
