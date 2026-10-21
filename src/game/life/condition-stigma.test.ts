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
  PERSON_CULTURE,
  RELATION_DIMS,
  RELATIONS,
  STIGMA,
  strangerDims,
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

describe("estigma de la condición mental (cableado)", () => {
  const content = loadContent(GAME_CONTENT_KINDS, sources("content"));

  function setup(kinTheory: string) {
    const l = Life.create(3, content, { conditionLabels: true, conditionStigma: true });
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
    const kin = people.filter((id) => id !== sick && truth.get(PERSON, id)?.household === home);
    const outsiders = people.filter(
      (id) => id !== sick && truth.get(PERSON, id)?.household !== home,
    );
    const known = outsiders.slice(0, 2);
    const stranger = outsiders[2];
    if (known.length < 2 || !stranger) throw new Error("faltan vecinos");
    const origin = l.world.log.all()[0]?.id;
    if (!origin) throw new Error("sin eventos");
    const theoryOf = (id: AgentId, variant: string) => {
      const pc = truth.get(PERSON_CULTURE, id);
      if (!pc) throw new Error("sin cultura");
      truth.set(PERSON_CULTURE, id, {
        ...pc,
        holdings: {
          ...pc.holdings,
          "mind.theory": {
            variant,
            shown: variant,
            strength: 1,
            learnedFrom: [],
            mode: "vertical",
            since: l.now,
          } as never,
        },
      });
    };
    for (const k of kin) theoryOf(k, kinTheory);
    for (const o of outsiders) theoryOf(o, "plain");
    // Los conocidos tienen relación con el enfermo; el extraño no.
    for (const o of known) {
      const rel = truth.get(RELATIONS, o);
      truth.set(RELATIONS, o, {
        toward: {
          ...(rel?.toward ?? {}),
          [sick]: {
            dims: strangerDims(content.all(RELATION_DIMS)),
            bonds: [],
            history: [],
            updated: l.now,
          },
        },
        originEventId: rel?.originEventId ?? origin,
      } as never);
    }
    const rel = truth.get(RELATIONS, stranger);
    if (rel?.toward[sick]) {
      const { [sick]: _gone, ...rest } = rel.toward;
      truth.set(RELATIONS, stranger, { ...rel, toward: rest });
    }
    truth.set(
      MENTAL,
      sick,
      openCondition(emptyMental(origin, l.now), "depression", 0.8, origin, {}, l.now),
    );
    return { l, truth, sick, kin, known, stranger };
  }

  it("los conocidos de afuera la creen con su etiqueta y le ponen estigma; la familia no", () => {
    const { l, truth, sick, kin, known } = setup("plain");
    l.advanceTo(l.now + 2 * DAY);
    for (const o of known) {
      expect(believed(truth.get(BELIEFS, o), sick, "condition")?.value).toBe("plain.depression");
    }
    const st = truth.get(STIGMA, sick);
    const by = Object.keys(st?.by ?? {});
    for (const o of known) expect(by).toContain(o);
    // Solo la ve quien lo conoce, no la familia ni cualquiera.
    for (const id of by) {
      expect(truth.get(RELATIONS, id as AgentId)?.toward[sick]).toBeDefined();
      expect(kin).not.toContain(id);
      expect(st?.by[id]).toBeGreaterThan(0);
    }
    expect(st?.originEventId).toBeDefined();
  }, 600_000);

  it("si la familia lo esconde (encierro) los de afuera no forman creencia ni estigma", () => {
    const { l, truth, sick, kin, known } = setup("weakness");
    l.advanceTo(l.now + 2 * DAY);
    for (const k of kin) {
      expect(believed(truth.get(BELIEFS, k), sick, "condition")?.value).toBe("weakness.depression");
    }
    for (const o of known) {
      expect(believed(truth.get(BELIEFS, o), sick, "condition")).toBeUndefined();
    }
    expect(truth.get(STIGMA, sick)).toBeUndefined();
  }, 600_000);

  it("curado, el estigma se va olvidando; y es determinista", () => {
    const run = () => {
      const { l, truth, sick } = setup("plain");
      l.advanceTo(l.now + 2 * DAY);
      const during = Object.keys(truth.get(STIGMA, sick)?.by ?? {}).length;
      const origin = l.world.log.all()[0]?.id;
      if (!origin) throw new Error("sin eventos");
      truth.set(MENTAL, sick, emptyMental(origin, l.now));
      l.advanceTo(l.now + 60 * DAY);
      return { during, after: truth.get(STIGMA, sick), hash: l.hash().total };
    };
    const a = run();
    expect(a.during).toBeGreaterThan(0);
    expect(a.after).toBeUndefined();
    expect(run().hash).toBe(a.hash);
  }, 600_000);
});
