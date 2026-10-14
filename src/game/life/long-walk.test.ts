import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import { type ActionPlan, hexPath, LEG_SECONDS, LOCATION, PLACE } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { PLAN_STATE } from "./act.ts";
import { engineOptions, LIFE_ENGINE, Life } from "./life.ts";

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

/**
 * perfil5-wound-variance: un camino de varios tramos dejaba `resume` encendido en el plan para
 * siempre; el paso siguiente (hablar, mirar) nunca llegaba y el personaje repetía el `move` hacia
 * donde ya estaba, un segundo por paso, tropezando en cada uno (3376 pasos y 42 heridas en un año).
 */
function longWalk(engine: string) {
  const life = Life.create(7, content, engineOptions(engine, { frequency: 8 }));
  const w = life.world;
  const me = life.player;
  const home = w.truth.get(LOCATION, me)?.hex as number;
  const target = w.truth
    .ids(PLACE)
    .find(
      (id) => String(id).startsWith("place:") && (w.truth.get(PLACE, id)?.hexes ?? []).length > 0,
    );
  if (!target) throw new Error("sin lugar propio");
  // Un punto a campo traviesa a varios tramos del lugar: se sale hex a hex hasta juntar la marcha.
  const inside = (w.truth.get(PLACE, target)?.hexes ?? []) as readonly number[];
  let at = (inside[0] as number) ?? home;
  let seconds = 0;
  const seen = new Set(inside);
  while (seconds < 2 * LEG_SECONDS) {
    const next = (w.map.neighbors[at] ?? []).find((n) => !seen.has(n) && !inside.includes(n));
    if (next === undefined) throw new Error("sin camino hacia afuera");
    seen.add(next);
    at = next;
    seconds = hexPath(w.map, at, inside[0] as number).reduce(
      (s, h) => s + (w.map.crossSeconds[h] ?? 0),
      0,
    );
  }

  w.truth.set(LOCATION, me, { hex: at });
  const plan: ActionPlan = {
    actor: me,
    source: "player",
    root: {
      kind: "seq",
      steps: [
        { kind: "do", verb: "move", args: [{ role: "to", entity: target }], manner: [] },
        { kind: "do", verb: "look", args: [], manner: [] },
      ],
    },
    manner: [],
    causes: [{ kind: "state", entity: me, key: "intent" }],
  };
  life.submit(plan, 1);
  life.advanceTo(life.now + Math.ceil(seconds * 2) + 3600);
  return { state: w.truth.get(PLAN_STATE, me) };
}

describe("caminar varios tramos y seguir con el plan", () => {
  it("al llegar apaga resume, hace el paso que sigue y termina sin repetir el move", () => {
    const { state } = longWalk(LIFE_ENGINE);
    expect(state?.resume).toBeUndefined();
    const verbs = (state?.steps ?? []).map((s) => s.verb);
    expect(verbs).toContain("look");
    expect(state?.done).toBe(true);
    expect(verbs.filter((v) => v === "move").length).toBeLessThan(10);
  });

  it("el motor anterior (life-10) conserva el defecto para el replay", () => {
    const { state } = longWalk("life-10");
    expect(state?.resume).toBe(true);
    expect((state?.steps ?? []).filter((s) => s.verb === "move").length).toBeGreaterThan(100);
  });
});
