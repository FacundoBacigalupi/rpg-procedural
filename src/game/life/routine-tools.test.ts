import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, type ItemId, loadContent } from "../../core/index.ts";
import {
  checkInvariants,
  ITEM_HOLD,
  ITEM_LOOK,
  ITEM_WEAR,
  LOCATION,
  localHour,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { engineOptions, Life } from "./life.ts";
import { FULL_PROFILE } from "./profile.ts";
import { ROUTINE_TOOL_RETURNED, ROUTINE_TOOL_TAKEN } from "./routine-tools.ts";

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
const DAY = 24 * 3600;

function fieldTools(life: Life): ItemId[] {
  const w = life.world;
  return ([...w.truth.ids(ITEM_LOOK)] as ItemId[])
    .sort()
    .filter((id) => ["hoe", "sickle"].includes(w.truth.get(ITEM_LOOK, id)?.shape ?? ""));
}

describe("la rutina de campo con la herramienta de la casa (perfil2-item-claims-item-demand-routine)", () => {
  it("salen al campo con la azada o la hoz, rinden más, la gastan y la devuelven a la casa", () => {
    const life = Life.create(7, content, { ...FULL_PROFILE, frequency: 8 });
    const w = life.world;
    const start = life.now;
    life.advanceTo(start + 3 * DAY);
    const since = w.log.all().filter((e) => e.tick >= start);
    const took = since.filter((e) => e.kind === ROUTINE_TOOL_TAKEN);
    const back = since.filter((e) => e.kind === ROUTINE_TOOL_RETURNED);
    expect(took.length).toBeGreaterThan(0);
    expect(back.length).toBeGreaterThan(0);
    const withTool = since.filter(
      (e) => e.kind === "routine.harvested" && (e.data as { tool?: string }).tool !== undefined,
    );
    expect(withTool.length).toBeGreaterThan(0);
    const tools = fieldTools(life);
    expect(tools.some((id) => (w.truth.get(ITEM_WEAR, id)?.wear ?? 0) > 0)).toBe(true);
    // A la noche ninguna está en manos de nadie: cada una en una casa, del hogar.
    while (localHour(w.clock, life.now, w.map.lonDeg) < 22) life.advanceTo(life.now + 3600);
    for (const id of tools) {
      const who = String(w.truth.get(ITEM_HOLD, id)?.possession);
      expect(who.startsWith("agent:")).toBe(false);
      expect(String(w.truth.get(LOCATION, id)?.space)).toContain(`house:${who}`);
    }
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  }, 300_000);

  it("un motor anterior a life-50 trabaja a mano", () => {
    const life = Life.create(
      7,
      content,
      engineOptions("life-49", { ...FULL_PROFILE, frequency: 8 }),
    );
    const start = life.now;
    life.advanceTo(start + DAY);
    expect(life.world.log.all().some((e) => e.kind === ROUTINE_TOOL_TAKEN)).toBe(false);
  }, 300_000);
});
