import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  type HolderRef,
  holderAccount,
  ledgerUnit,
  loadContent,
} from "../../core/index.ts";
import { checkInvariants, hexPath, LOCATION, PERSON, PLACE } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { NPC_DECISION } from "./decide.ts";
import { Life } from "./life.ts";
import { NPC_JOURNEY } from "./npc-verbs.ts";
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
const grain = ledgerUnit("good:grain");
const DAY = 86_400;

describe("el viajero come de sus provisiones en el camino (opt-in)", () => {
  it("sale con grano de la despensa, come en una hora de comida interrumpiendo el tramo y devuelve lo que sobra", () => {
    const life = Life.create(7, content, {
      npcVerbs: ["move"],
      npcJourneyDays: 6,
      npcProvisions: { good: "grain", grams: 600 },
    });
    const w = life.world;
    const npc = living(w.truth).find(
      (x) =>
        x !== life.player && (w.truth.get(PERSON, x)?.born ?? 0) < life.now - 20 * 365 * 86_400,
    ) as AgentId;
    const home = w.truth.get(PERSON, npc)?.household as string;
    const larder = holderAccount(home as unknown as HolderRef);
    const pocket = holderAccount(npc as unknown as HolderRef);
    // Sale a unos hexes de un lugar.
    const place = w.truth.ids(PLACE)[0] as string;
    const hexes = (w.truth.get(PLACE, place as never)?.hexes ?? []) as number[];
    let from = hexes[0] as number;
    for (let i = 0; i < 4; i++) {
      from =
        (w.map.neighbors[from] ?? []).find(
          (n) => !hexes.includes(n) && hexPath(w.map, n, hexes[0] as number).length > i,
        ) ?? from;
    }
    w.truth.set(LOCATION, npc, { hex: from });
    const before = w.ledger.balance(larder, grain);
    expect(before).toBeGreaterThanOrEqual(600);
    const total = w.ledger.total(grain);
    w.truth.set(NPC_DECISION, npc, {
      at: life.now,
      id: `move:${place}+toward:agent:99`,
      verb: "move",
      target: place,
      utility: 1,
      options: 2,
    } as never);

    life.advanceTo(life.now + 2 * 3600);
    expect(w.ledger.balance(pocket, grain)).toBe(600);
    expect(w.ledger.balance(larder, grain)).toBe(before - 600);

    life.advanceTo(life.now + 5 * DAY);
    const ate = w.log
      .all()
      .filter((e) => e.kind === "action.eat" && e.actors[0] === npc && e.tick > 0);
    expect(ate.length).toBeGreaterThan(0);
    expect(w.truth.get(NPC_JOURNEY, npc)).toBeUndefined();
    // Come de lo que lleva (no de la despensa lejana) y lo que sobra vuelve: el bolsillo queda vacío.
    const first = ate[0] as NonNullable<(typeof ate)[number]>;
    expect((first.data as { effect: { good: string | null } }).effect.good).toBe(grain);
    expect(w.ledger.balance(pocket, grain)).toBe(0);
    expect(total).toBeGreaterThan(0);
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  }, 240_000);
});
