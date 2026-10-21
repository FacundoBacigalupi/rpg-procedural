import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, loadContent } from "../../core/index.ts";
import {
  BELIEFS,
  believed,
  ENTITY,
  emptyMental,
  MENTAL,
  openCondition,
  PERSON,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";

const DAY = 86400;

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}

describe("creencia de condiciones mentales (cableado)", () => {
  const content = loadContent(GAME_CONTENT_KINDS, sources("content"));

  it("la casa cree el mal con su etiqueta, citando el evento; los de afuera no", () => {
    const l = Life.create(3, content, { conditionLabels: true });
    const truth = l.world.truth;
    const alive = (id: AgentId) => truth.get(ENTITY, id)?.endedAt === undefined;
    const people = (truth.ids(PERSON) as AgentId[]).filter(alive);
    const sick = people.find((id) =>
      people.some(
        (o) => o !== id && truth.get(PERSON, o)?.household === truth.get(PERSON, id)?.household,
      ),
    );
    if (!sick) throw new Error("sin hogar con dos personas");
    const home = truth.get(PERSON, sick)?.household;
    const origin = l.world.log.all()[0]?.id;
    if (!origin) throw new Error("sin eventos");
    truth.set(
      MENTAL,
      sick,
      openCondition(emptyMental(origin, l.now), "grief", 0.7, origin, {}, l.now),
    );
    l.advanceTo(l.now + 2 * DAY);
    const kin = people.filter((id) => id !== sick && truth.get(PERSON, id)?.household === home);
    const outsiders = people.filter(
      (id) => id !== sick && truth.get(PERSON, id)?.household !== home,
    );
    const own = believed(truth.get(BELIEFS, sick), sick, "condition");
    expect(typeof own?.value).toBe("string");
    expect(own?.sources[0]).toMatchObject({ kind: "percept", event: origin });
    for (const k of kin) {
      expect(believed(truth.get(BELIEFS, k), sick, "condition")).toBeDefined();
    }
    for (const o of outsiders) {
      expect(believed(truth.get(BELIEFS, o), sick, "condition")).toBeUndefined();
    }
  }, 600_000);

  it("encendido es determinista", () => {
    const run = () => {
      const l = Life.create(3, content, { conditionLabels: true });
      l.advanceTo(l.now + DAY * 60);
      return l.hash().total;
    };
    expect(run()).toBe(run());
  }, 600_000);
});
