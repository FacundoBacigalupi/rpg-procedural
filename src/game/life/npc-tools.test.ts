import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, type ItemId, loadContent } from "../../core/index.ts";
import {
  type ActionPlan,
  checkInvariants,
  houseKey,
  ITEM_HOLD,
  ITEM_LOOK,
  ITEM_WEAR,
  LOCATION,
  PERSON,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { PLAN_STATE } from "./act.ts";
import { NPC_DECISION } from "./decide.ts";
import { Life } from "./life.ts";
import { withHouseholdTool } from "./npc-tools.ts";
import { FULL_PROFILE } from "./profile.ts";

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
const DAY = 24 * 3600;

function fieldwork(actor: string, field: string, home: string): ActionPlan {
  return {
    actor: actor as never,
    source: "utility",
    goal: "fieldwork",
    root: {
      kind: "seq",
      steps: [
        { kind: "do", verb: "move", args: [{ role: "to", entity: field as never }], manner: [] },
        { kind: "do", verb: "work", args: [{ role: "for", seconds: 14400 }], manner: [] },
        { kind: "do", verb: "move", args: [{ role: "to", entity: home as never }], manner: [] },
      ],
    },
    manner: [],
    causes: [],
  };
}

describe("el NPC lleva la herramienta de su casa (perfil2-item-claims-item-demand-npc)", () => {
  it("la plantilla de campo agarra la azada de la casa, trabaja con ella y la deja al volver", () => {
    const life = Life.create(7, content, { frequency: 8, itemClaims: true, householdTools: true });
    const w = life.world;
    const hoe = [...w.truth.ids(ITEM_LOOK)]
      .sort()
      .find((id) => w.truth.get(ITEM_LOOK, id)?.shape === "hoe") as ItemId | undefined;
    if (hoe === undefined) throw new Error("no hay azada");
    const household = w.truth.get(ITEM_HOLD, hoe)?.possession;
    const npc = [...w.truth.ids(PERSON)]
      .sort()
      .find(
        (id) =>
          id !== w.player &&
          String(w.truth.get(PERSON, id)?.household) === String(household) &&
          w.truth.get(LOCATION, id)?.hex === w.truth.get(LOCATION, hoe)?.hex,
      );
    if (npc === undefined) throw new Error("nadie de esa casa está en la aldea");
    const plan = fieldwork(npc, "place:1", "place:2");
    const tooled = withHouseholdTool(plan, w.catalog, w.truth, npc as never);
    if (tooled.root.kind !== "seq") throw new Error("no es secuencia");
    const steps = tooled.root.steps.map((s) => (s.kind === "do" ? s : undefined));
    expect(steps.map((s) => s?.verb)).toEqual(["take", "move", "work", "move", "drop"]);
    expect(steps[0]?.args).toEqual([{ role: "what", entity: hoe }]);
    expect(steps[2]?.args).toContainEqual({ role: "with", entity: hoe });
    expect(steps[3]?.args).toContainEqual({
      role: "space",
      text: houseKey(String(household) as never),
    });
    expect(steps[4]?.args).toEqual([{ role: "what", entity: hoe }]);

    // Sin un paso con instrumento o sin volver al final, el plan queda igual.
    const noReturn: ActionPlan = {
      ...plan,
      root: { kind: "seq", steps: plan.root.kind === "seq" ? plan.root.steps.slice(0, 2) : [] },
    };
    expect(withHouseholdTool(noReturn, w.catalog, w.truth, npc as never)).toBe(noReturn);
    // Llevada por otro, ya no está en la casa.
    w.truth.set(ITEM_HOLD, hoe, { possession: w.player as never, rights: [] });
    const others = withHouseholdTool(plan, w.catalog, w.truth, npc as never);
    expect(others.root.kind === "seq" && others.root.steps.length).toBe(
      w.truth
        .ids(ITEM_LOOK)
        .some(
          (id) =>
            id !== hoe &&
            ["hoe", "sickle"].includes(w.truth.get(ITEM_LOOK, id)?.shape ?? "") &&
            String(w.truth.get(ITEM_HOLD, id)?.possession) === String(household),
        )
        ? 5
        : 3,
    );
  }, 300_000);

  it("con el perfil completo, quien decide trabajar el campo lleva la azada y la devuelve", () => {
    const life = Life.create(7, content, { ...FULL_PROFILE, frequency: 8 });
    const w = life.world;
    // Alguien en su casa con una herramienta de campo suelta ahí decide trabajar (lo que en la aldea
    // suele hacer la rutina): el plan de la plantilla la agarra.
    const npc = [...w.truth.ids(PERSON)].sort().find((id) => {
      if (id === w.player) return false;
      const plan = fieldwork(id, "place:1", "place:2");
      const tooled = withHouseholdTool(plan, w.catalog, w.truth, id as never);
      return tooled !== plan;
    });
    if (npc === undefined) throw new Error("nadie en casa con herramienta de campo");
    w.truth.set(NPC_DECISION, npc as never, {
      at: life.now,
      id: "work:",
      verb: "work",
      utility: 1,
      options: 1,
    });
    life.advanceTo(life.now + 3600);
    const state = w.truth.get(PLAN_STATE, npc as never);
    expect(state?.plan.goal).toBe("fieldwork");
    const first = state?.plan.root.kind === "seq" ? state.plan.root.steps[0] : undefined;
    const tool = first?.kind === "do" ? first.args.find((a) => a.role === "what") : undefined;
    const item = (tool && "entity" in tool ? tool.entity : "") as ItemId;
    expect(String(item)).toMatch(/^item:/);
    const home = w.truth.get(PERSON, npc as never)?.household;
    life.advanceTo(life.now + DAY);
    // Trabajó con ella (se gastó) y la dejó en su casa, otra vez del hogar.
    expect(w.truth.get(ITEM_WEAR, item)?.wear ?? 0).toBeGreaterThan(0);
    expect(String(w.truth.get(ITEM_HOLD, item)?.possession)).toBe(String(home));
    expect(String(w.truth.get(LOCATION, item)?.space)).toContain(houseKey(home as never));
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  }, 300_000);
});
