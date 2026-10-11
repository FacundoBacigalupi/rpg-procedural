import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, loadContent } from "../../core/index.ts";
import { ACTIONS, ActionCatalog, LOCATION, PERSON, PLACE, PLANS } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { PLAN_STATE } from "./act.ts";
import { NPC_DECISION } from "./decide.ts";
import { Life } from "./life.ts";
import { planFromDecision } from "./npc-verbs.ts";
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
const catalog = new ActionCatalog(content.all(ACTIONS), content.all(PLANS));
const me = "agent:1" as AgentId;

describe("planFromDecision", () => {
  it("arma el plan del catálogo con los argumentos del id, en orden", () => {
    const gather = planFromDecision({ id: "gather:hierba", verb: "gather" }, catalog, me);
    expect(gather?.source).toBe("utility");
    expect(gather?.root).toEqual({
      kind: "do",
      verb: "gather",
      args: [{ role: "what", text: "hierba" }],
      manner: [],
    });
    expect(planFromDecision({ id: "gather:", verb: "gather" }, catalog, me)?.root).toMatchObject({
      args: [],
    });
    expect(
      planFromDecision({ id: "trade:agent:2+grano", verb: "trade" }, catalog, me)?.root,
    ).toMatchObject({
      args: [
        { role: "with", entity: "agent:2" },
        { role: "what", text: "grano" },
      ],
    });
  });

  it("no ejecuta ids de otro proceso, verbos desconocidos ni argumentos que faltan", () => {
    expect(planFromDecision({ id: "speak:agent:2+borrow:té", verb: "speak" }, catalog, me)).toBe(
      undefined,
    );
    expect(planFromDecision({ id: "give:agent:2+pawn:hoz", verb: "give" }, catalog, me)).toBe(
      undefined,
    );
    expect(planFromDecision({ id: "nada:", verb: "nada" }, catalog, me)).toBe(undefined);
    expect(planFromDecision({ id: "trade:", verb: "trade" }, catalog, me)).toBe(undefined);
    expect(planFromDecision({ id: "gather:a+b", verb: "gather" }, catalog, me)).toBe(undefined);
  });
});

function setup(npcVerbs: readonly string[] | undefined, id: string, verb: string) {
  const life = Life.create(7, content, npcVerbs ? { npcVerbs } : {});
  const w = life.world;
  const npc = living(w.truth).find(
    (x) => x !== life.player && (w.truth.get(PERSON, x)?.born ?? 0) < life.now - 20 * 365 * 86_400,
  ) as AgentId;
  const forest = w.truth.ids(PLACE).find((p) => w.truth.get(PLACE, p)?.kind === "forest");
  const hex = forest ? w.truth.get(PLACE, forest)?.hexes[0] : undefined;
  if (hex !== undefined) w.truth.set(LOCATION, npc, { hex });
  w.truth.set(NPC_DECISION, npc, { at: life.now, id, verb, utility: 1, options: 2 } as never);
  return { life, w, npc };
}

const HOUR = 3600;

describe("el NPC ejecuta su decisión (opt-in)", () => {
  it("gather: la decisión vigente se vuelve un action.gather suyo, una sola vez", () => {
    const on = setup(["gather"], "gather:", "gather");
    on.life.advanceTo(on.life.now + 6 * HOUR);
    const mine = on.w.log.all().filter((e) => e.kind === "action.gather" && e.actors[0] === on.npc);
    expect(mine.length).toBeGreaterThan(0);
    expect(on.w.truth.get(PLAN_STATE, on.npc)?.plan.source).toBe("utility");

    const off = setup(undefined, "gather:", "gather");
    off.life.advanceTo(off.life.now + 6 * HOUR);
    expect(off.w.log.all().some((e) => e.kind === "action.gather" && e.actors[0] === off.npc)).toBe(
      false,
    );
  }, 120_000);
});
