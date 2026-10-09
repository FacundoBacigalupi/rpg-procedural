import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, loadContent } from "../../core/index.ts";
import {
  type ActionPlan,
  checkInvariants,
  LOCATION,
  PERSON,
  PLEDGE,
  PLEDGE_BOOK,
} from "../../sim/index.ts";
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

const say = (actor: AgentId, to: AgentId, text: string): ActionPlan => ({
  actor,
  source: "player",
  root: {
    kind: "do",
    verb: "speak",
    args: [
      { role: "to", entity: to },
      { role: "content", text },
    ],
    manner: [],
  },
  manner: [],
  causes: [{ kind: "state", entity: actor, key: "intent" }],
});

function promiseTo(seed: number) {
  const life = Life.create(seed, content);
  const w = life.world;
  const me = life.player;
  const house = w.truth.get(PERSON, me)?.household;
  const other = living(w.truth).find(
    (id) => id !== me && w.truth.get(PERSON, id)?.household === house,
  ) as AgentId;
  const here = w.truth.get(LOCATION, me);
  if (here) w.truth.set(LOCATION, other, here);
  const report = life.turn(say(me, other, "Te prometo 500 gramos de grano"), 1);
  const reply = report.events.find((e) => e.kind === "action.speak" && e.actors[0] === other);
  const line = (reply?.data as { effect: { reply: string } } | undefined)?.effect.reply;
  return { life, w, me, other, line, reply };
}

describe("promesas del personaje en el juego", () => {
  it("la promesa aceptada abre un compromiso con origen en el evento y un libro por parte", () => {
    const { w, me, other, line, reply } = promiseTo(7);
    const ids = w.truth.ids(PLEDGE);
    if (line !== "promise.accept") {
      expect(ids).toEqual([]);
      return;
    }
    expect(ids).toHaveLength(1);
    const p = w.truth.get(PLEDGE, ids[0] as never);
    expect(p?.promisor).toBe(me);
    expect(p?.promisee).toBe(other);
    expect(p?.status).toBe("open");
    expect(p?.history).toEqual([reply?.id]);
    expect(w.truth.get(PLEDGE_BOOK, me)?.items[0]?.role).toBe("promisor");
    expect(w.truth.get(PLEDGE_BOOK, other)?.items[0]?.role).toBe("promisee");
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  }, 60_000);

  it("es determinista", () => {
    const run = () => promiseTo(7).life.hash();
    expect(run()).toEqual(run());
  }, 60_000);
});
