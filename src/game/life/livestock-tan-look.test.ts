import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, type EntityRef, loadContent } from "../../core/index.ts";
import {
  type ActionPlan,
  ANIMAL,
  BUILDING,
  ENTITY,
  type IntentDraft,
  LOCATION,
  PERSON,
  planFromDraft,
  TANNING,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { fixturesInSight } from "./fixtures.ts";
import { knownEntities } from "./known.ts";
import { Life } from "./life.ts";
import { inventoryPanel } from "./panels.ts";
import { itemsSeen, playerView } from "./view.ts";
import type { LifeWorld } from "./world.ts";

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

const slaughter = (actor: string): ActionPlan => ({
  actor: actor as never,
  source: "player",
  root: { kind: "do", verb: "slaughter", args: [{ role: "what", text: "la cabra" }], manner: [] },
  manner: [],
  causes: [{ kind: "state", entity: actor as never, key: "intent" }],
});

function look(w: LifeWorld, text: string) {
  return planFromDraft(
    {
      kind: "act",
      plan: { kind: "do", verb: "look", args: [{ role: "target", ref: { text, features: [] } }] },
    } as IntentDraft,
    {
      actor: w.player,
      source: "player",
      catalog: w.catalog,
      known: knownEntities(w, [], itemsSeen(w)),
      clock: w.clock,
      causes: [{ kind: "state", entity: w.player, key: "intent" }],
      here: w.truth.get(LOCATION, w.player)?.hex,
    },
  );
}

/** El personaje pasa a la casa de una cabra, la carnea y espera a que la piel vaya a la tina. */
function withVat(): { l: Life; vat: EntityRef } {
  const l = Life.create(3, content, {
    frequency: 8,
    villageLivestock: true,
    livestockDairy: true,
    livestockLife: true,
    livestockSlaughter: true,
    livestockTan: true,
  });
  const t = l.world.truth;
  const goat = [...t.ids(ANIMAL)]
    .sort()
    .find(
      (id) => t.get(ANIMAL, id)?.species === "goat" && t.get(ENTITY, id)?.endedAt === undefined,
    );
  const owner = goat === undefined ? undefined : t.get(ANIMAL, goat)?.owner;
  const hex = goat === undefined ? undefined : t.get(LOCATION, goat)?.hex;
  const me = t.get(PERSON, l.player);
  if (owner === undefined || hex === undefined || me === undefined) throw new Error("sin cabra");
  t.set(PERSON, l.player, { ...me, household: owner });
  t.set(LOCATION, l.player, { hex });
  l.turn(slaughter(l.player), 1);
  l.advanceTo(l.now + 2 * DAY);
  const vat = [...t.ids(TANNING)].sort().find((id) => t.get(TANNING, id)?.household === owner);
  if (vat === undefined) throw new Error("sin tina");
  return { l, vat };
}

describe("la tina a la vista (livestock-hide-tan-look)", () => {
  it("en el patio se ve y se mira; el panel dice qué se curte y cuánto falta", () => {
    const { l, vat } = withVat();
    const w = l.world;
    // Fuera del patio no está a la vista.
    expect(fixturesInSight(w).some((f) => f.shape === "vat")).toBe(false);
    const b = w.truth.get(BUILDING, vat);
    const yard = b?.graph.spaces.find(
      (s) => w.spaces.spaces.find((n) => n.key === s.key)?.indoor === false,
    );
    const hex = w.truth.get(LOCATION, w.player)?.hex;
    if (yard === undefined || hex === undefined) throw new Error("sin patio");
    w.truth.set(LOCATION, w.player, { hex, space: yard.key });
    expect(fixturesInSight(w).find((f) => f.shape === "vat")).toEqual({
      ref: vat,
      shape: "vat",
      state: "soaking",
    });
    expect(inventoryPanel(w).vats).toEqual([
      { good: "piel cruda", into: "cuero curtido", left: "weeks" },
    ]);
    // Lo que queda de piel en la despensa dice cuánto hay, no cuánto alcanza.
    for (const row of inventoryPanel(w).larder.filter((r) => r.good === "piel cruda")) {
      expect(row.lasts).toBeUndefined();
      expect(row.amount).toBeDefined();
    }

    // Casi a término: se ve casi curtida y el panel dice que falta poco.
    const batch = w.truth.get(TANNING, vat);
    if (!batch) throw new Error("sin tanda");
    w.truth.set(TANNING, vat, { ...batch, startedAt: w.scheduler.now - 40 * w.clock.day });
    expect(fixturesInSight(w).find((f) => f.shape === "vat")?.state).toBe("almost");
    expect(inventoryPanel(w).vats?.[0]?.left).toBe("soon");

    const made = look(w, "la tina");
    expect(made.kind).toBe("plan");
    if (made.kind !== "plan") return;
    const target = (made.plan.root as unknown as { args: { entity?: string }[] }).args[0]?.entity;
    expect(target).toBe(vat);
    const report = l.turn(made.plan, 1);
    const view = playerView(w, report.steps, { heardSince: report.from });
    const thing = view.things?.find((t) => t.shape === "vat");
    const now = fixturesInSight(w).find((f) => f.shape === "vat");
    if (now === undefined) {
      // El turno la vació (salió el cuero): ya no hay tina que mirar.
      expect(w.truth.get(TANNING, vat)).toBeUndefined();
    } else {
      expect(thing).toMatchObject({ shape: "vat", looked: true, state: now.state });
    }
  }, 600_000);
});
