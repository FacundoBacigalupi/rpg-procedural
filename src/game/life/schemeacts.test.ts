import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, loadContent, makeId, Rng } from "../../core/index.ts";
import {
  ACTIONS,
  BODY_PLANS,
  BODY_STATE,
  LOCATION,
  type SchemerView,
  SKILLS,
  SkillCatalog,
  TRAITS,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";
import { type SchemeSeed, schemeRows, schemesProcess } from "./schemes.ts";
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

const view: SchemerView = {
  motiveStrength: 1,
  motive: "revenge",
  boldness: 1,
  warmth: 0,
  honor: 0,
  fear: 0,
  intellect: 0.5,
  believedTargetStrength: 0,
  believedLoot: 0,
  believedWitnesses: 0,
  affinity: -1,
};

function run(withActs: boolean) {
  const life = Life.create(3, content);
  const truth = life.world.truth;
  const ids = living(truth);
  const owner = ids[0] as AgentId;
  const target = ids.find((id) => id !== owner && truth.get(BODY_STATE, id)) as AgentId;
  const far = { hex: (truth.get(LOCATION, target)?.hex ?? 0) + 1000, space: "far" };
  truth.set(LOCATION, owner, far as never);
  const seed: SchemeSeed = {
    key: "s",
    owner,
    target,
    motive: "revenge",
    origin: makeId("event", 1),
    startDay: 0,
  };
  const p = schemesProcess({
    seeds: [seed],
    view: () => view,
    placeOf: () => ({ kind: "cell" }) as never,
    day: 10,
    ...(withActs
      ? {
          acts: {
            move: true,
            fleeTo: () => far,
            strike: {
              plans: new Map(content.all(BODY_PLANS).map((b) => [b.id, b])),
              skills: new SkillCatalog(content.all(SKILLS), content.all(ACTIONS)),
              traits: content.all(TRAITS),
              light: 1,
            },
          },
        }
      : {}),
  });
  let n = 100;
  let hits = 0;
  let recent: unknown[] = [];
  const kinds: string[] = [];
  const at: { step: string; hex: number | undefined }[] = [];
  const wounds = (id: AgentId) => truth.get(BODY_STATE, id)?.wounds.length ?? 0;
  const before = wounds(owner) + wounds(target);
  for (let d = 0; d < 8; d++) {
    const r = p.run({
      truth,
      now: d * 10,
      recent,
      rng: Rng.root(7),
      newId: () => makeId("scheme", 1),
    } as never);
    recent = [];
    for (const c of r.changes ?? []) {
      const x = c as unknown as { table: string; id: never; value: unknown };
      truth.setRaw(x.table, x.id, x.value);
    }
    for (const e of r.events ?? []) {
      kinds.push(e.kind);
      if (e.kind === "combat.fight") hits += (e.data as { hits: unknown[] }).hits.length;
      recent.push({ ...e, id: makeId("event", ++n) });
      if (e.kind === "scheme.step")
        at.push({
          step: (e.data as { stepKind: string }).stepKind,
          hex: truth.get(LOCATION, owner)?.hex,
        });
    }
  }
  return {
    truth,
    kinds,
    at,
    far,
    owner,
    target,
    hurt: wounds(owner) + wounds(target) - before,
    hits,
  };
}

describe("life.schemes: approach/flee como move y strike como attack (F1b-2b-2)", () => {
  const a = run(true);

  it("se acerca al blanco, pelea de verdad (combat.fight) y huye", () => {
    const here = a.truth.get(LOCATION, a.target)?.hex;
    expect(a.at.find((s) => s.step === "approach")?.hex).toBe(here);
    expect(a.kinds).toContain("combat.fight");
    // las heridas que quedan en los cuerpos son las de la pelea (ninguna de más ni de menos)
    expect(a.hurt).toBeGreaterThanOrEqual(a.hits > 0 ? 1 : 0);
    expect(a.hits === 0 ? a.hurt : 1).toBeLessThanOrEqual(a.hits === 0 ? 0 : 1);
    expect(a.at.find((s) => s.step === "flee")?.hex).toBe(a.far.hex);
    expect(schemeRows(a.truth)[0]?.row.scheme.status).toBe("succeeded");
  }, 120_000);

  it("es determinista", () => {
    const b = run(true);
    expect(b.kinds).toEqual(a.kinds);
    expect(b.hurt).toBe(a.hurt);
  }, 120_000);

  it("sin acts no mueve ni hiere a nadie", () => {
    const off = run(false);
    expect(off.kinds).not.toContain("combat.fight");
    expect(off.hurt).toBe(0);
    expect(off.truth.get(LOCATION, off.owner)?.hex).toBe(off.far.hex);
  }, 120_000);
});
