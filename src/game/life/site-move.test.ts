import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import {
  checkInvariants,
  type IntentDraft,
  LOCATION,
  planFromDraft,
  VILLAGE_SQUARE,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { knownEntities, knownSpaces } from "./known.ts";
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

const go = (text: string): IntentDraft =>
  ({
    kind: "act",
    plan: {
      kind: "do",
      verb: "move",
      args: [{ role: "to", ref: { text, kind: "place", features: [] } }],
    },
  }) as IntentDraft;

describe("moverse adentro de la aldea (espacios del sitio)", () => {
  it("«afuera» lleva de la casa a la plaza y «a casa» vuelve, en minutos y sin perderse", () => {
    const life = Life.create(7, content, { frequency: 8 });
    const w = life.world;
    const plan = (text: string) => {
      const known = knownEntities(w);
      const made = planFromDraft(go(text), {
        actor: w.player,
        source: "player",
        catalog: w.catalog,
        known,
        clock: w.clock,
        causes: [{ kind: "state", entity: w.player, key: "intent" }],
        here: w.truth.get(LOCATION, w.player)?.hex,
        spaces: knownSpaces(w, known),
      });
      if (made.kind !== "plan") throw new Error(`${text}: ${made.kind}`);
      return made.plan;
    };
    const home = w.truth.get(LOCATION, w.player);
    expect(home?.space).toBeDefined();
    expect(w.spaces.spaces.find((s) => s.key === home?.space)?.indoor).toBe(true);

    const out = plan("afuera");
    expect(out.root).toMatchObject({ verb: "move", args: [{ role: "to" }, { role: "space" }] });
    const before = w.scheduler.now;
    life.turn(out, 1);
    expect(w.truth.get(LOCATION, w.player)).toEqual({ hex: home?.hex, space: VILLAGE_SQUARE });
    expect(w.scheduler.now - before).toBeLessThan(15 * 60);
    expect(w.scheduler.now).toBeGreaterThan(before);

    // Ya en la plaza, «afuera» no es nada; «mi casa» sí.
    expect(knownSpaces(w, knownEntities(w)).some((s) => s.names.includes("afuera"))).toBe(false);
    life.turn(plan("mi casa"), 1);
    expect(w.truth.get(LOCATION, w.player)).toEqual(home);
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  }, 300_000);

  it("la casa de un familiar se nombra por la relación", () => {
    const life = Life.create(7, content, { frequency: 8 });
    const w = life.world;
    const known = knownEntities(w);
    const spaces = knownSpaces(w, known);
    const mother = known.find((k) => k.relations.some((r) => r.rel === "madre"));
    if (!mother) return;
    const theirs = spaces.find((s) => s.owners.includes(mother.ref));
    expect(theirs).toBeDefined();
    const made = planFromDraft(go("la casa de mi madre"), {
      actor: w.player,
      source: "player",
      catalog: w.catalog,
      known,
      clock: w.clock,
      causes: [{ kind: "state", entity: w.player, key: "intent" }],
      spaces,
    });
    expect(made.kind).toBe("plan");
    if (made.kind === "plan")
      expect(made.plan.root).toMatchObject({
        args: [{ role: "to" }, { role: "space", text: theirs?.key }],
      });
  });
});
