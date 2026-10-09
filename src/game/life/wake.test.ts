import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, loadContent, Rng } from "../../core/index.ts";
import { BODY_STATE, type Body, PERSON } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";
import { WAKE_EVENT, wakeOf } from "./wake.ts";
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

describe("el velorio", () => {
  it("la aldea acompaña a la casa del muerto: asistentes, consuelo de cada doliente y determinismo", () => {
    const life = Life.create(10, content);
    const w = life.world;
    const home = w.truth.get(PERSON, life.player)?.household;
    const kin = living(w.truth).filter((id) => w.truth.get(PERSON, id)?.household === home);
    const dead = kin.find((id) => id !== life.player) as AgentId;
    const mourners = kin.filter((id) => id !== dead);
    const rng = Rng.root(7);
    const wake = wakeOf(w.truth, dead, mourners, rng.fork("t"));
    expect(wake).not.toBeNull();
    expect(wake?.attendees).not.toContain(dead);
    for (const id of wake?.comfort.keys() ?? []) expect(mourners).toContain(id);
    for (const c of wake?.comfort.values() ?? []) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
    expect(wakeOf(w.truth, dead, mourners, rng.fork("t"))).toEqual(wake);
  }, 120_000);

  it("al morir alguien de la casa queda el evento del velorio citando la muerte", () => {
    const life = Life.create(10, content);
    const w = life.world;
    const home = w.truth.get(PERSON, life.player)?.household;
    const dead = living(w.truth).find(
      (id) => id !== life.player && w.truth.get(PERSON, id)?.household === home,
    ) as AgentId;
    const body = w.truth.get(BODY_STATE, dead) as Body;
    w.truth.set(BODY_STATE, dead, {
      ...body,
      death: { cause: "brain_trauma", at: life.now },
    } as Body);
    life.advanceTo(life.now + 2 * 86_400);
    const death = w.log.all().find((e) => e.kind === "body.died" && e.actors.includes(dead));
    const wake = w.log.all().find((e) => e.kind === WAKE_EVENT);
    expect(death).toBeDefined();
    expect(wake?.causes).toEqual([{ kind: "event", event: death?.id }]);
    expect(wake?.actors[0]).toBe(dead);
  }, 120_000);
});
