import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import {
  BUILDING,
  checkInvariants,
  type IntentDraft,
  LOCATION,
  planFromDraft,
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

describe("ir al santuario (shrine-move)", () => {
  it("sin santuario no se nombra; con él, «voy al santuario» lleva adentro", () => {
    const plain = Life.create(7, content, { frequency: 8 }).world;
    expect(
      knownSpaces(plain, knownEntities(plain)).some((s) => s.names.includes("el santuario")),
    ).toBe(false);

    const life = Life.create(7, content, { frequency: 8, villageShrine: true });
    const w = life.world;
    const shrine = [...w.truth.ids(BUILDING)].find(
      (id) => w.truth.get(BUILDING, id)?.type === "shrine",
    );
    const known = knownEntities(w);
    const spaces = knownSpaces(w, known);
    const named = spaces.find((s) => s.names.includes("el santuario"));
    expect(named?.key).toBe(shrine);
    // El granero se sigue nombrando igual.
    expect(spaces.some((s) => s.names.includes("el granero"))).toBe(true);
    const made = planFromDraft(go("el santuario"), {
      actor: w.player,
      source: "player",
      catalog: w.catalog,
      known,
      clock: w.clock,
      causes: [{ kind: "state", entity: w.player, key: "intent" }],
      here: w.truth.get(LOCATION, w.player)?.hex,
      spaces,
    });
    if (made.kind !== "plan") throw new Error(made.kind);
    life.turn(made.plan, 1);
    expect(w.truth.get(LOCATION, w.player)?.space).toBe(shrine);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  }, 300_000);
});
