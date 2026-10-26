import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, loadContent } from "../../core/index.ts";
import type { ActionPlan } from "../../sim/index.ts";
import { BUILDING, LOCATION, PERSON } from "../../sim/index.ts";
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

/** El registro con que se juzgó lo que el personaje le dijo a un vecino en `where`. */
function registerAt(where: "shrine" | "here") {
  const life = Life.create(7, content, { frequency: 8, villageShrine: true });
  const w = life.world;
  const me = life.player;
  const home = w.truth.get(PERSON, me)?.household;
  const hearer = living(w.truth).find(
    (id) => id !== me && w.truth.get(PERSON, id)?.household !== home,
  ) as AgentId;
  const at = w.truth.get(LOCATION, me);
  if (!at) throw new Error("el personaje no está en ningún lado");
  const shrine = [...w.truth.ids(BUILDING)].find(
    (id) => w.truth.get(BUILDING, id)?.type === "shrine",
  );
  const loc = where === "shrine" ? { ...at, space: shrine as string } : at;
  w.truth.set(LOCATION, me, loc as never);
  w.truth.set(LOCATION, hearer, loc as never);
  const report = life.turn(say(me, hearer, "Hola"), 1);
  const reply = report.events.find((e) => e.actors[0] === hearer && e.kind === "action.speak");
  return (reply?.data as { effect?: { form?: { register: string; used: number } } } | undefined)
    ?.effect?.form;
}

describe("el registro del santuario (shrine-register)", () => {
  it("adentro del santuario se habla con el registro del templo, más formal que en casa", () => {
    const shrine = registerAt("shrine");
    const home = registerAt("here");
    expect(shrine?.register).toBe("village.shrine");
    expect(home?.register).toBeDefined();
    expect(home?.register).not.toBe("village.shrine");
    expect(shrine?.used ?? 0).toBeGreaterThan(home?.used ?? 0);
  }, 300_000);
});
