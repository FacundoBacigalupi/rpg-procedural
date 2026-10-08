import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, loadContent } from "../../core/index.ts";
import {
  COMPANY_FAMILIARITY,
  contactGain,
  LOCATION,
  PERSON,
  RELATIONS,
  type Relations,
  TALK_FAMILIARITY,
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

describe("el contacto rinde menos cuanto más se conocen", () => {
  it("es proporcional al hueco y nunca negativo", () => {
    expect(contactGain(TALK_FAMILIARITY, 0)).toBe(TALK_FAMILIARITY);
    expect(contactGain(TALK_FAMILIARITY, 0.5)).toBeLessThan(TALK_FAMILIARITY);
    expect(contactGain(COMPANY_FAMILIARITY, 1)).toBe(0);
    expect(contactGain(COMPANY_FAMILIARITY, 2)).toBe(0);
  });
});

describe("la aldea se hace compañía", () => {
  const familiarity = (life: Life, a: AgentId, b: AgentId) =>
    (life.world.truth.get(RELATIONS, a) as Relations | undefined)?.toward[b]?.dims.familiarity ?? 0;

  /** Dos de una misma casa que no se conocen del todo: de noche duermen bajo el mismo techo. */
  function housemates(life: Life): [AgentId, AgentId] {
    const t = life.world.truth;
    const all = living(t);
    for (const a of all) {
      const b = all.find(
        (x) => x !== a && t.get(PERSON, x)?.household === t.get(PERSON, a)?.household,
      );
      if (b && familiarity(life, a, b) < 0.95 && familiarity(life, b, a) < 0.95) return [a, b];
    }
    throw new Error("ninguna casa con dos");
  }

  it("compartir el espacio sostiene la familiaridad: no cae pese al paso del tiempo", () => {
    const life = Life.create(7, content);
    const [a, b] = housemates(life);
    const before = [familiarity(life, a, b), familiarity(life, b, a)];
    life.advanceTo(life.now + life.world.clock.day / 24);
    expect(familiarity(life, a, b)).toBeGreaterThan(before[0] ?? 0);
    expect(familiarity(life, b, a)).toBeGreaterThan(before[1] ?? 0);
  }, 180_000);

  it("hablar con alguien suma familiaridad a ambos", () => {
    const life = Life.create(7, content);
    const t = life.world.truth;
    const me = life.player;
    const home = t.get(PERSON, me)?.household;
    const n = living(t).find((id) => t.get(PERSON, id)?.household !== home);
    const here = t.get(LOCATION, me);
    if (!n || !here) throw new Error("sin vecino");
    t.set(LOCATION, n, here);
    const before = [familiarity(life, me, n), familiarity(life, n, me)];
    const report = life.turn(
      {
        actor: me,
        source: "player",
        root: {
          kind: "do",
          verb: "speak",
          args: [
            { role: "to", entity: n },
            { role: "content", text: "Buen día" },
          ],
          manner: [],
        },
        manner: [],
        causes: [{ kind: "state", entity: me, key: "intent" }],
      },
      1,
    );
    expect(report.events.some((e) => e.kind === "action.speak")).toBe(true);
    expect(familiarity(life, me, n)).toBeGreaterThan(before[0] ?? 0);
    expect(familiarity(life, n, me)).toBeGreaterThan(before[1] ?? 0);
  }, 180_000);

  it("es determinista", () => {
    const run = () => {
      const life = Life.create(7, content);
      const [a, b] = housemates(life);
      life.advanceTo(life.now + 2 * life.world.clock.day);
      return JSON.stringify([familiarity(life, a, b), familiarity(life, b, a)]);
    };
    expect(run()).toBe(run());
  }, 360_000);
});
