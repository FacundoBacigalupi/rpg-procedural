import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  type Event,
  type EventId,
  loadContent,
  type PlaceRef,
} from "../../core/index.ts";
import { LOCATION, PERSON } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";
import {
  importanceTiers,
  NPC_PERCEPTS,
  npcPerceive,
  TIER3_QUOTA,
  type WitnessingOptions,
  witnessRng,
} from "./witnessing.ts";
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

describe("life.witnessing con un mundo", () => {
  it("el vecino del hex ve trabajar, el de otro hex no, y el personaje no entra en NPC_PERCEPTS", () => {
    const life = Life.create(7, content);
    const w = life.world;
    const t = w.truth;
    const others = living(t).filter((x) => x !== life.player);
    const [actor, near, far] = others;
    if (!actor || !near || !far) throw new Error("falta gente");
    const at = t.get(LOCATION, actor);
    if (!at) throw new Error("sin lugar");
    t.set(LOCATION, near, at);
    t.set(LOCATION, far, { hex: at.hex + 1 });
    t.set(LOCATION, life.player, at);
    const o: WitnessingOptions = {
      player: life.player,
      map: w.map,
      spaces: w.spaces,
      clock: w.clock,
      seed: w.seed,
      statuses: w.statuses,
    };
    const e = {
      id: "event:999999" as EventId,
      tick: life.now,
      kind: "action.work",
      actors: [actor],
      place: { kind: "none" } as unknown as PlaceRef,
      data: null,
      emissions: { sight: 1, sound: 1 },
      causes: [],
    } as unknown as Event;
    const out = npcPerceive(o, t, [e], witnessRng(w.seed));
    expect(out.get(near)?.length ?? 0).toBeGreaterThan(0);
    expect(out.has(far)).toBe(false);
    expect(out.has(life.player)).toBe(false);
    expect(out.has(actor)).toBe(false);
    // Determinista: la misma tirada da lo mismo.
    const again = npcPerceive(o, t, [e], witnessRng(w.seed));
    expect(JSON.stringify([...again])).toEqual(JSON.stringify([...out]));
    expect(t.get(PERSON, near)).toBeDefined();
  }, 180_000);

  it("el hogar del personaje es de tier 3 (con cupo) y el resto de la aldea de tier 2", () => {
    const life = Life.create(7, content);
    const t = life.world.truth;
    const tierOf = importanceTiers(t, life.player);
    const home = t.get(PERSON, life.player)?.household;
    const others = living(t).filter((x) => x !== life.player);
    const tier3 = others.filter((x) => tierOf(x) === 3);
    expect(tier3.length).toBeGreaterThan(0);
    expect(tier3.length).toBeLessThanOrEqual(TIER3_QUOTA);
    for (const id of others) {
      const mine = t.get(PERSON, id)?.household === home;
      if (tierOf(id) === 3) expect(mine).toBe(true);
      else expect(tierOf(id)).toBe(2);
    }
  }, 180_000);

  it("tras un día, el personaje nunca figura en NPC_PERCEPTS y dos corridas dan el mismo hash", () => {
    const a = Life.create(7, content);
    const b = Life.create(7, content);
    a.advanceTo(a.now + a.world.clock.day);
    b.advanceTo(b.now + b.world.clock.day);
    expect(a.world.truth.get(NPC_PERCEPTS, a.player as AgentId)).toBeUndefined();
    expect(a.hash()).toEqual(b.hash());
  }, 300_000);
});
