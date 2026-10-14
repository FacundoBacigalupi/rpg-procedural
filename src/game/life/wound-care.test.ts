import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, type EventId, loadContent, makeId, Rng } from "../../core/index.ts";
import {
  type ActionPlan,
  BODY_STATE,
  type Body,
  injure,
  nextTreatment,
  treat,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { engineOptions, Life } from "./life.ts";
import { suggestions } from "./suggest.ts";

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
const hit = makeId("event", 7) as EventId;

const tendPlan = (me: Life["player"]): ActionPlan => ({
  actor: me,
  source: "player",
  root: { kind: "do", verb: "tend", args: [], manner: [] },
  manner: [],
  causes: [{ kind: "state", entity: me, key: "intent" }],
});

/** Un cráneo roto y un tajo en el brazo: busca la tirada que da fractura (la parte al azar es solo la herida). */
function hurtPlayer(life: Life): Body {
  const w = life.world;
  const body = w.truth.get(BODY_STATE, life.player) as Body;
  const plan = w.plans.find((p) => p.id === body.plan);
  if (!plan) throw new Error("sin plan de cuerpo");
  for (let s = 0; s < 200; s++) {
    const skull = injure(
      plan,
      body,
      { kind: "blunt", force: 0.9, zone: "head", dirt: 0.7, cause: hit, at: life.now },
      Rng.root(s),
    );
    if (!skull.wound.fracture) continue;
    const cut = injure(
      plan,
      skull.body,
      { kind: "cut", force: 0.15, zone: "left_arm", dirt: 0.7, cause: hit, at: life.now },
      Rng.root(s + 1000),
    );
    if (cut.wound.bleeding > 0.01) return { ...cut.body, consciousness: "alert" };
  }
  throw new Error("no salió una fractura");
}

describe("curar: tend mira todas las heridas (perfil5-bot-wound-care)", () => {
  it("nextTreatment: venda lo que sangra, entablilla el hueso, limpia lo infectado y termina en null", () => {
    const life = Life.create(7, content, { frequency: 8 });
    let body = hurtPlayer(life);
    const seen: string[] = [];
    for (let i = 0; i < 12; i++) {
      const next = nextTreatment(body);
      if (next === null) break;
      seen.push(next.how);
      body = treat(body, next.wound, next.how);
    }
    expect(seen).toContain("splint");
    expect(seen).toContain("bandage");
    expect(body.wounds.filter((w) => w.fracture).every((w) => w.splinted)).toBe(true);
    expect(nextTreatment(body)).toBeNull();
  });

  it("tend del personaje acaba entablillando el cráneo; con life-9 nunca", () => {
    const run = (engine: string) => {
      const life = Life.create(7, content, engineOptions(engine, { frequency: 8 }));
      life.world.truth.set(BODY_STATE, life.player, hurtPlayer(life));
      for (let i = 0; i < 12; i++) life.turn(tendPlan(life.player), 1);
      const b = life.world.truth.get(BODY_STATE, life.player) as Body;
      return b.wounds.filter((w) => w.fracture).map((w) => w.splinted);
    };
    const now = run("life-10");
    expect(now.length).toBeGreaterThan(0);
    expect(now.every(Boolean)).toBe(true);
    expect(run("life-9").some(Boolean)).toBe(false);
    expect(run("life-10")).toEqual(now);
  }, 120_000);

  it("la opción sugerida de curar aparece herido y desaparece curado", () => {
    const life = Life.create(7, content, { frequency: 8 });
    life.world.truth.set(BODY_STATE, life.player, hurtPlayer(life));
    expect(suggestions(life.world).some((s) => s.kind === "tend")).toBe(true);
    let body = life.world.truth.get(BODY_STATE, life.player) as Body;
    for (let n = nextTreatment(body); n !== null; n = nextTreatment(body)) {
      body = treat(body, n.wound, n.how);
    }
    life.world.truth.set(BODY_STATE, life.player, body);
    expect(suggestions(life.world).some((s) => s.kind === "tend")).toBe(false);
  }, 60_000);
});
