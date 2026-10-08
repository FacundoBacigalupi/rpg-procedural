import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import { checkInvariants, STANDING_BELIEFS, STATUS } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";
import { living } from "./world.ts";

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

describe("la posición ajena como creencia, en el juego", () => {
  it("al convivir un día, los vecinos guardan una lectura de los demás con un evento que la causa", () => {
    const life = Life.create(7, content);
    life.advanceTo(life.now + life.world.clock.day);
    const t = life.world.truth;
    const rows = living(t).flatMap((id) => t.get(STANDING_BELIEFS, id)?.beliefs ?? []);
    expect(rows.length).toBeGreaterThan(0);
    for (const b of rows) {
      expect(life.world.log.get(b.originEventId)?.kind).toBe("social.standing_read");
      expect(b.confidence).toBeGreaterThan(0);
      expect(t.get(STATUS, b.about)).toBeDefined();
    }
    expect(checkInvariants({ truth: t, log: life.world.log, ledger: life.world.ledger })).toEqual(
      [],
    );
  }, 180_000);

  it("es determinista: dos vidas con el mismo seed guardan las mismas lecturas", () => {
    const read = () => {
      const life = Life.create(7, content);
      life.advanceTo(life.now + life.world.clock.day);
      const t = life.world.truth;
      return living(t).map((id) => t.get(STANDING_BELIEFS, id) ?? null);
    };
    expect(read()).toEqual(read());
  }, 240_000);
});
