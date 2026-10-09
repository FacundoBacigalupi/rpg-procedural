import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  type EventId,
  loadContent,
  Rng,
  type Tick,
} from "../../core/index.ts";
import { KNOWN_DEEDS, LOCATION, RELATION_BONDS, RELATION_DIMS, TRAITS } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { GOSSIP_PROCESS, gossipProcess, RUMOR_TOLD_EVENT } from "./gossip.ts";
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

describe("chisme entre vecinos", () => {
  it("lo contado queda como rumor con linaje, hecho told y memoria told, con causa en el hecho", () => {
    const life = Life.create(7, content);
    const w = life.world;
    const [teller, listener, doer, victim] = living(w.truth) as AgentId[] as [
      AgentId,
      AgentId,
      AgentId,
      AgentId,
    ];
    const root = w.log.all()[0]?.id as EventId;
    const here = w.truth.get(LOCATION, teller);
    if (!here) throw new Error("sin lugar");
    w.truth.set(LOCATION, listener, here);
    w.truth.set(KNOWN_DEEDS, teller, {
      deeds: [{ kind: "assault", by: doer, victim, event: root, at: 0 as Tick, via: "saw" }],
    });
    const proc = gossipProcess({
      dims: content.all(RELATION_DIMS),
      bonds: content.all(RELATION_BONDS),
      traits: content.all(TRAITS),
      placeOf: () => ({ hex: 0 }) as never,
      player: "agent:none" as AgentId,
    });
    expect(proc.id).toBe(GOSSIP_PROCESS);
    let told = 0;
    for (let seed = 0; seed < 40 && told === 0; seed++) {
      const out = proc.run({
        truth: w.truth,
        now: life.now,
        rng: Rng.root(seed),
        recent: [],
      } as never) as unknown as {
        changes?: unknown[];
        events?: { kind: string; causes: unknown[] }[];
      };
      if (!out.events?.length) continue;
      told++;
      expect(out.events[0]?.kind).toBe(RUMOR_TOLD_EVENT);
      expect(out.events[0]?.causes).toEqual([{ kind: "event", event: root }]);
      expect(out.changes?.length).toBeGreaterThan(0);
    }
    expect(told).toBe(1);
  }, 60_000);
});
