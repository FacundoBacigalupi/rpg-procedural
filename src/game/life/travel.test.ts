import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import { type ActionPlan, checkInvariants, LOCATION, PLACE } from "../../sim/index.ts";
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

/** El personaje va al monte: un `move` hacia el lugar de tipo bosque. */
function toTheForest(seed: number) {
  const life = Life.create(seed, content);
  const w = life.world;
  const me = life.player;
  const forest = w.truth.ids(PLACE).find((id) => w.truth.get(PLACE, id)?.kind === "forest");
  if (!forest) throw new Error("la aldea no tiene monte");
  const plan: ActionPlan = {
    actor: me,
    source: "player",
    root: { kind: "do", verb: "move", args: [{ role: "to", entity: forest }], manner: [] },
    manner: [],
    causes: [{ kind: "state", entity: me, key: "intent" }],
  };
  const report = life.turn(plan, 1);
  return { life, w, me, forest, report };
}

describe("caminar por tramos", () => {
  const run = toTheForest(7);

  it("un viaje largo deja un evento por tramo pero un solo paso, y termina adentro del monte", () => {
    const moves = run.report.events.filter((e) => e.kind === "action.move");
    expect(moves.length).toBeGreaterThanOrEqual(1);
    expect(run.report.steps.filter((s) => s.verb === "move")).toHaveLength(1);
    const hexes = run.w.truth.get(PLACE, run.forest)?.hexes as readonly number[];
    expect(hexes).toContain(run.w.truth.get(LOCATION, run.me)?.hex);
    expect(checkInvariants({ truth: run.w.truth, log: run.w.log, ledger: run.w.ledger })).toEqual(
      [],
    );
  }, 120_000);

  it("es determinista", () => {
    expect(toTheForest(7).life.hash()).toEqual(run.life.hash());
  }, 120_000);
});
