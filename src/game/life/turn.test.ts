import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import { parseCommand } from "../../llm/index.ts";
import { type ActionPlan, checkInvariants, planFromDraft } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
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

function planOf(life: Life, text: string): ActionPlan {
  const draft = parseCommand(text, life.world.catalog);
  if (!draft) throw new Error(`la gramática no entiende: ${text}`);
  const r = planFromDraft(draft, {
    actor: life.player,
    source: "player",
    catalog: life.world.catalog,
    known: [],
    clock: life.world.clock,
    causes: [{ kind: "state", entity: life.player, key: "intent" }],
  });
  if (r.kind !== "plan") throw new Error(`no es un plan: ${JSON.stringify(r)}`);
  return r.plan;
}

describe("el turno real", () => {
  it("esperar una hora avanza el mundo, deja un paso con autopercepción y es determinista", () => {
    const run = () => {
      const life = Life.create(7, content);
      const report = life.turn(planOf(life, "espero una hora"), 1);
      return { life, report };
    };
    const a = run();
    expect(a.report.over).toBe(false);
    expect(a.report.steps.map((s) => s.verb)).toEqual(["wait"]);
    expect(a.report.to - a.report.from).toBeGreaterThanOrEqual(3000);
    expect(checkInvariants({ truth: a.life.world.truth, log: a.life.world.log })).toEqual([]);
    expect(run().life.hash()).toEqual(a.life.hash());
  }, 120_000);

  it("comer de la despensa de la casa pasa por el cuerpo y el ledger", () => {
    const life = Life.create(7, content);
    const report = life.turn(planOf(life, "como"), 1);
    expect(report.steps.map((s) => s.verb)).toEqual(["eat"]);
    const effect = report.steps[0]?.self.effect;
    expect(effect).toMatchObject({ kind: "eat" });
    expect((effect as { kcal: number }).kcal).toBeGreaterThan(0);
    expect(checkInvariants({ truth: life.world.truth, log: life.world.log })).toEqual([]);
  }, 120_000);
});
