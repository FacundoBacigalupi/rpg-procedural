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
import {
  type ActionPlan,
  AMENDS,
  didDeed,
  KNOWN_DEEDS,
  LOCATION,
  OWN_DEEDS,
  PERSON,
  RELATION_BONDS,
  RELATION_DIMS,
  TRAITS,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";
import { giveTestimony, type TestifyOptions } from "./testify.ts";
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

const strike = (actor: AgentId, target: AgentId): ActionPlan => ({
  actor,
  source: "player",
  root: { kind: "do", verb: "strike", args: [{ role: "target", entity: target }], manner: [] },
  manner: [],
  causes: [{ kind: "state", entity: actor, key: "intent" }],
});

describe("culpa cableada", () => {
  const life = Life.create(10, content);
  const w = life.world;
  const me = life.player;
  const home = w.truth.get(PERSON, me)?.household;
  const target = living(w.truth).filter((id) => w.truth.get(PERSON, id)?.household !== home)[0];
  const here = w.truth.get(LOCATION, me);
  if (target && here) w.truth.set(LOCATION, target, here);
  life.turn(strike(me, target as AgentId), 1);
  const own = didDeed(w.truth.get(OWN_DEEDS, me), "assault", target as AgentId);

  it("quien pegó anota el hecho como propio, aunque nadie lo supiera", () => {
    expect(own).toBeDefined();
    expect(own?.event).toBeDefined();
  });

  it("preguntado por su hecho, lo reconoce si decidió confesar y lo niega si no", () => {
    const o: TestifyOptions = {
      dims: content.all(RELATION_DIMS),
      bonds: content.all(RELATION_BONDS),
      traits: content.all(TRAITS),
      placeOf: () => ({ hex: 0 }) as never,
    };
    const asker = target as AgentId;
    const event = own?.event as EventId;
    const ask = (response: "confess" | "deflect") => {
      w.truth.set(AMENDS, me, {
        byDeed: { [event]: { response, guilt: 0.7, decided: life.now as Tick } },
      });
      w.truth.set(KNOWN_DEEDS, asker, { deeds: [] });
      const out = giveTestimony(
        w.truth,
        o,
        me,
        asker,
        { deed: event },
        event,
        life.now,
        Rng.root(3),
      );
      return out?.testimony;
    };
    expect(ask("confess")).toMatchObject({ kind: "assault", accused: me, certainty: 1 });
    expect(ask("deflect")).toMatchObject({ kind: null, accused: null });
  });
});
