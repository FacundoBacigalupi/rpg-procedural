import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, loadContent } from "../../core/index.ts";
import { type ActionPlan, BODY_STATE, checkInvariants, LOCATION, PERSON } from "../../sim/index.ts";
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

const strikePlan = (actor: AgentId, target: AgentId): ActionPlan => ({
  actor,
  source: "player",
  root: { kind: "do", verb: "strike", args: [{ role: "target", entity: target }], manner: [] },
  manner: [],
  causes: [{ kind: "state", entity: actor, key: "intent" }],
});

/** Una pelea del personaje contra alguien de su casa, parados en el mismo lugar. */
function brawl(seed: number) {
  const life = Life.create(seed, content);
  const w = life.world;
  const me = life.player;
  const house = w.truth.get(PERSON, me)?.household;
  const other = living(w.truth).find(
    (id) => id !== me && w.truth.get(PERSON, id)?.household === house,
  ) as AgentId;
  const here = w.truth.get(LOCATION, me);
  if (here) w.truth.set(LOCATION, other, here);
  const report = life.turn(strikePlan(me, other), 1);
  return { life, w, me, other, report };
}

describe("el golpe del personaje es una pelea", () => {
  const run = brawl(3);

  it("deja el evento de la pelea con causa en el golpe, heridas a los dos lados y el ledger sano", () => {
    const fight = run.report.events.find((e) => e.kind === "combat.fight");
    expect(fight).toBeDefined();
    expect(fight?.actors).toEqual([run.me, run.other]);
    const strike = run.report.events.find((e) => e.kind === "action.strike");
    expect(fight?.causes).toEqual([{ kind: "event", event: strike?.id }]);
    const hurt = [run.me, run.other].map(
      (id) => run.w.truth.get(BODY_STATE, id)?.wounds.length ?? 0,
    );
    expect((hurt[0] ?? 0) + (hurt[1] ?? 0)).toBeGreaterThan(0);
    expect(run.report.to - run.report.from).toBeGreaterThan(1);
    expect(checkInvariants({ truth: run.w.truth, log: run.w.log, ledger: run.w.ledger })).toEqual(
      [],
    );
  }, 120_000);

  it("es determinista", () => {
    expect(brawl(3).life.hash()).toEqual(run.life.hash());
  }, 120_000);
});
