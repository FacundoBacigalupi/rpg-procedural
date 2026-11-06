import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, HOUR, loadContent } from "../../core/index.ts";
import type { ActionPlan } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { ROUTINE_TOLERATED_SIGNS } from "./interrupts.ts";
import { Life, MAX_ROUTINE_DAYS, MAX_TURN_DAYS } from "./life.ts";
import { delegatedPlan } from "./routine.ts";

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

const DAY = 24 * HOUR;
const skip = (me: Life["player"], days: number, source: ActionPlan["source"]): ActionPlan => ({
  actor: me,
  source,
  root: { kind: "do", verb: "wait", args: [{ role: "for", seconds: days * DAY }], manner: [] },
  manner: [],
  causes: [{ kind: "state", entity: me, key: "intent" }],
});

describe("saltos de tiempo delegados (novel-montage-live)", () => {
  it("puro: solo un plan `routine` de solo esperas delega; el cansancio no corta el salto", () => {
    const me = "agent:1" as Life["player"];
    const on = { done: false, plan: skip(me, 3, "routine") };
    expect(delegatedPlan(on)).toBe(true);
    expect(delegatedPlan({ ...on, done: true })).toBe(false);
    expect(delegatedPlan({ done: false, plan: skip(me, 3, "player") })).toBe(false);
    expect(MAX_ROUTINE_DAYS).toBeGreaterThan(MAX_TURN_DAYS);
    expect([...ROUTINE_TOLERATED_SIGNS]).toEqual(["exhausted"]);
  });

  it("delegado, el personaje vive la rutina del hogar más allá del tope de un turno; esperando, no trabaja; determinista", () => {
    const run = (source: ActionPlan["source"]) => {
      const life = Life.create(7, content, { frequency: 8 });
      const start = life.now;
      const r = life.turn(skip(life.player, 40, source), 1);
      const count = (k: string) => r.events.filter((e) => e.kind === k).length;
      return {
        life,
        days: (r.to - start) / DAY,
        interrupt: r.interrupt,
        worked: count("routine.harvested"),
        ate: count("routine.ate"),
      };
    };
    const on = run("routine");
    expect(on.interrupt).toBeNull();
    expect(on.days).toBeGreaterThanOrEqual(40);
    expect(on.worked).toBeGreaterThan(0);
    expect(on.ate).toBeGreaterThanOrEqual(3 * 39);
    expect(on.life.alive).toBe(true);
    expect(run("routine").life.hash().total).toBe(on.life.hash().total);
    const off = run("player");
    expect(off.worked).toBe(0);
    expect(off.days).toBeLessThanOrEqual(MAX_TURN_DAYS + 1);
  }, 600_000);
});
