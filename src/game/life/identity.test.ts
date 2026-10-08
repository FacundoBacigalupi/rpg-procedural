import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  type Event,
  type EventId,
  loadContent,
} from "../../core/index.ts";
import { CULTURE_TRAITS, PERSON, type Percept } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { ascribeFromPercepts, VISIBLE_DOMAINS, visibleMarks } from "./identity.ts";
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
const traits = content.all(CULTURE_TRAITS);

describe("el grupo que el personaje cree de lo que ve", () => {
  const life = Life.create(7, content);
  const { truth } = life.world;
  const other = truth.ids(PERSON).find((id) => id !== life.player) as AgentId;
  const event = { id: 99 as unknown as EventId, actors: [other] } as unknown as Event;
  const seen = (detail: "clear" | "vague"): Percept =>
    ({ sourceEventId: event.id, detail }) as unknown as Percept;

  it("solo se leen marcas de dominios visibles", () => {
    const marks = visibleMarks(truth, other, traits);
    for (const id of Object.keys(marks)) {
      expect(VISIBLE_DOMAINS).toContain(traits.find((t) => t.id === id)?.domain);
    }
  });

  it("lo visto con detalle se vuelve creencia con la marca como base", () => {
    const got = ascribeFromPercepts(truth, life.player, [seen("clear")], [event], traits);
    const belief = got?.about[other];
    expect(belief?.group).toBe("village");
    expect(belief?.basis).toEqual(["markers"]);
    expect(belief?.confidence).toBeGreaterThan(0);
  });

  it("lo vago o de uno mismo no crea creencia", () => {
    expect(ascribeFromPercepts(truth, life.player, [seen("vague")], [event], traits)).toBe(
      undefined,
    );
    const mine = { ...event, actors: [life.player] } as unknown as Event;
    expect(ascribeFromPercepts(truth, life.player, [seen("clear")], [mine], traits)).toBe(
      undefined,
    );
  });
});
