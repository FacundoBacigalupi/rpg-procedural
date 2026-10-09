import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, type EventId, loadContent } from "../../core/index.ts";
import { KNOWN_DEEDS, LOCATION, RELATIONS } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { ASK_WINDOW, askChance, whomToAsk } from "./askaround.ts";
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

describe("la víctima que pregunta alrededor", () => {
  it("solo pregunta a gente que está donde ella, por un hecho reciente y que no es suyo", () => {
    const life = Life.create(7, content);
    const t = life.world.truth;
    const [victim, near, doer] = living(t) as AgentId[];
    const where = t.get(LOCATION, victim as AgentId);
    if (where) t.set(LOCATION, near as AgentId, where);
    const event = life.world.log.all()[0]?.id as EventId;
    const at = life.now;
    t.set(KNOWN_DEEDS, victim as AgentId, {
      deeds: [
        { kind: "theft", by: doer as AgentId, victim: victim as AgentId, event, at, via: "saw" },
      ],
    });
    const plan = whomToAsk(t, victim as AgentId, at);
    expect(plan?.event).toBe(event);
    expect(plan?.candidates).not.toContain(doer);
    expect(plan?.candidates).not.toContain(victim);
    // Pasada la ventana, deja de preguntar.
    expect(whomToAsk(t, victim as AgentId, at + ASK_WINDOW + 1)).toBeNull();
    // Si el hecho no la tiene de víctima, no sale a preguntar.
    expect(whomToAsk(t, near as AgentId, at)).toBeNull();
  }, 60_000);

  it("el vecino sale a preguntar por lo que le contaron solo si lo une un vínculo con la víctima", () => {
    const life = Life.create(7, content);
    const t = life.world.truth;
    const [victim, near, doer, other] = living(t) as AgentId[];
    const where = t.get(LOCATION, near as AgentId);
    if (where) t.set(LOCATION, other as AgentId, where);
    const event = life.world.log.all()[0]?.id as EventId;
    const at = life.now;
    t.set(KNOWN_DEEDS, near as AgentId, {
      deeds: [
        { kind: "theft", by: doer as AgentId, victim: victim as AgentId, event, at, via: "told" },
      ],
    });
    const rel = (bonds: string[]) => ({
      toward: {
        [victim as string]: {
          dims: {} as never,
          bonds,
          history: [],
          updated: at,
        },
        [other as string]: { dims: {} as never, bonds: [], history: [], updated: at },
      },
      originEventId: event,
    });
    t.set(RELATIONS, near as AgentId, rel([]));
    expect(whomToAsk(t, near as AgentId, at)).toBeNull();
    t.set(RELATIONS, near as AgentId, rel(["sibling"]));
    const plan = whomToAsk(t, near as AgentId, at);
    expect(plan?.neighbour).toBe(true);
    expect(plan?.event).toBe(event);
  }, 60_000);

  it("el sociable y el que lo vivió hondo salen más a preguntar que el retraído indiferente", () => {
    expect(askChance(1, 0.9)).toBeGreaterThan(askChance(0, 0.5));
    expect(askChance(0, 0.5)).toBeGreaterThan(askChance(-1, 0.1));
    expect(askChance(1, 1)).toBeLessThanOrEqual(1);
    expect(askChance(-1, 0)).toBeGreaterThanOrEqual(0);
  });
});
