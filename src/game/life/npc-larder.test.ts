import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import { checkInvariants, PERSON } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { INVENTORY_BELIEF } from "./inventory-belief.ts";
import { Life } from "./life.ts";
import { FULL_PROFILE } from "./profile.ts";

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
const DAY = 86_400;

describe("los NPC revisan su despensa al comer (livestock-draft-rest-npc-larder)", () => {
  it("encendido: quien come de la casa tiene foto de la despensa de ese momento; apagado, solo el jugador; determinista", () => {
    const run = (on: boolean) => {
      const l = Life.create(7, content, {
        frequency: 8,
        villageLivestock: true,
        livestockDraft: true,
        livestockDraftRestBelief: true,
        livestockDraftRestNpcLarder: on,
      });
      l.advanceTo(l.now + 3 * DAY);
      return l;
    };
    const on = run(true);
    const t = on.world.truth;
    const npcs = [...t.ids(INVENTORY_BELIEF)].filter((id) => id !== on.player);
    expect(npcs.length).toBeGreaterThan(0);
    // Cada foto es de cuando comió: después de su última comida, no antes.
    for (const id of npcs) {
      const b = t.get(INVENTORY_BELIEF, id as never);
      expect(t.get(PERSON, id as never)).toBeDefined();
      const last = on.world.log
        .all()
        .filter((e) => e.actors.includes(id as never) && e.kind === "routine.ate")
        .at(-1);
      if (last !== undefined) expect(b?.asOf).toBeGreaterThanOrEqual(last.tick);
    }
    const off = run(false);
    expect([...off.world.truth.ids(INVENTORY_BELIEF)].filter((id) => id !== off.player)).toEqual(
      [],
    );
    const w = on.world;
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
    expect(run(true).hash().total).toBe(on.hash().total);
    expect(FULL_PROFILE).toMatchObject({ livestockDraftRestNpcLarder: true });
  }, 600_000);
});
