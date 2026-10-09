import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, type EventId, loadContent } from "../../core/index.ts";
import { emptyMental, LOCATION, MENTAL, openCondition, PERSON } from "../../sim/index.ts";
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

describe("intrusión despierta", () => {
  it("quien comparte el sitio con el disparador acaba con un recuerdo intrusivo con causa", () => {
    const life = Life.create(7, content);
    const t = life.world.truth;
    const me = life.player;
    const home = t.get(PERSON, me)?.household;
    const other = living(t).find((id) => t.get(PERSON, id)?.household !== home) as AgentId;
    const cause = "event:0" as EventId;
    t.set(
      MENTAL,
      me,
      openCondition(emptyMental(cause, life.now), "trauma", 1, cause, { who: other }, life.now),
    );
    let hit = false;
    for (let h = 0; h < 24 * 10 && !hit; h++) {
      const here = t.get(LOCATION, me);
      if (here) t.set(LOCATION, other, here);
      life.advanceTo(life.now + life.world.clock.day / 24);
      hit = life.world.log.all().some((e) => e.kind === "mind.intrusion" && e.actors.includes(me));
    }
    expect(hit).toBe(true);
  }, 300_000);
});
