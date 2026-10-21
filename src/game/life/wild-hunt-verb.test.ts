import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  externalAccount,
  holderAccount,
  loadContent,
  type PlaceId,
} from "../../core/index.ts";
import { LOCATION, PERSON, PLACE } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { NPC_DECISION } from "./decide.ts";
import { GAME_UNIT, HUNT_SOURCE } from "./ecology.ts";
import { Life } from "./life.ts";
import { living } from "./world.ts";

const DAY = 86400;

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}

describe("verbo hunt: la carne que dejó la caza la toma una persona", () => {
  const content = loadContent(GAME_CONTENT_KINDS, sources("content"));

  function run(days: number) {
    const life = Life.create(7, content, { wildHunt: true, wildHuntScale: 40, npcVerbs: ["hunt"] });
    const w = life.world;
    const npc = living(w.truth).find(
      (x) => x !== life.player && (w.truth.get(PERSON, x)?.born ?? 0) < life.now - 20 * 365 * DAY,
    ) as AgentId;
    const forests = w.truth.ids(PLACE).filter((p) => w.truth.get(PLACE, p)?.kind === "forest");
    const hex = forests[0] ? w.truth.get(PLACE, forests[0])?.hexes[0] : undefined;
    if (hex === undefined) throw new Error("sin monte");
    const meat = () =>
      w.ledger.balance(holderAccount({ kind: "agent", id: npc } as never), GAME_UNIT);
    const inForest = () =>
      forests.reduce(
        (s, p) =>
          s +
          w.ledger.balance(
            holderAccount({ kind: "place", place: p as unknown as PlaceId }),
            GAME_UNIT,
          ),
        0,
      );
    let atStart = -1;
    for (let d = 0; d < days; d++) {
      w.truth.set(LOCATION, npc, { hex });
      w.truth.set(NPC_DECISION, npc, {
        at: life.now,
        id: "hunt:",
        verb: "hunt",
        utility: 1,
        options: 2,
      } as never);
      life.advanceTo(life.now + DAY);
      if (d === 0) atStart = inForest();
    }
    const hunts = w.log.all().filter((e) => e.kind === "action.hunt" && e.actors[0] === npc);
    return { life, meat: meat(), inForest: inForest(), atStart, hunts };
  }

  it("un cazador se lleva carne de la cuenta del monte, con ledger y evento", () => {
    const r = run(20);
    expect(r.hunts.length).toBeGreaterThan(0);
    const taken = r.hunts.reduce(
      (n, e) => n + Number((e.data as { effect?: { amount?: number } }).effect?.amount ?? 0),
      0,
    );
    expect(taken).toBeGreaterThan(0);
    // Lo que se llevó nunca supera lo que la caza dejó en los montes (fuente `hunt`).
    const minted = -r.life.world.ledger.balance(externalAccount(HUNT_SOURCE), GAME_UNIT);
    expect(taken).toBeLessThanOrEqual(minted);
    expect(r.life.world.ledger.audit()).toEqual([]);
    // La carne salió de la fuente de la caza: nada apareció sin pasar por `wild.hunted`.
    expect(r.life.world.ledger.balance(externalAccount(HUNT_SOURCE), GAME_UNIT)).toBeLessThan(0);
  }, 300_000);

  it("determinista: misma corrida, mismo hash", () => {
    expect(run(4).life.hash().total).toBe(run(4).life.hash().total);
  }, 300_000);
});
