import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import { type ActionPlan, checkInvariants, type PlanNode } from "../../sim/index.ts";
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

const look: PlanNode = { kind: "do", verb: "look", args: [], manner: [] };
const wait: PlanNode = {
  kind: "do",
  verb: "wait",
  args: [{ role: "for", seconds: 600 }],
  manner: [],
};

describe("repeat e if en una vida", () => {
  it("el personaje ejecuta un plan con repeat e if: mira tres veces y, según lo que cree, espera o vuelve a mirar", () => {
    const life = Life.create(7, content, { frequency: 8 });
    const w = life.world;
    const me = life.player;
    const root: PlanNode = {
      kind: "seq",
      steps: [
        { kind: "repeat", body: look, times: 3 },
        // biome-ignore lint/suspicious/noThenProperty: el nodo `if` de actions §3; nunca se espera con await
        { kind: "if", cond: { kind: "succeeded" }, then: wait, else: look },
      ],
    };
    const plan: ActionPlan = {
      actor: me,
      source: "player",
      root,
      manner: [],
      causes: [{ kind: "state", entity: me, key: "intent" }],
    };
    const t0 = life.now;
    const report = life.turn(plan, 1);
    const mine = (verb: string) =>
      w.log.all().filter((e) => e.kind === `action.${verb}` && e.tick >= t0 && e.actors[0] === me);
    // Las tres miradas del repeat y una cuarta cosa elegida por el if: espera si creyó que le salió.
    expect(mine("look").length).toBeGreaterThanOrEqual(3);
    expect(mine("look").length + mine("wait").length).toBe(4);
    expect(report.steps.length).toBeGreaterThanOrEqual(4);
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  }, 300_000);
});
