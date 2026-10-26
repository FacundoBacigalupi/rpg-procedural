import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, holderAccount, loadContent } from "../../core/index.ts";
import {
  type DraftResult,
  HEARTH,
  HEARTH_WARMING,
  type IntentDraft,
  LOCATION,
  PERSON,
  planFromDraft,
  type ThermalEnv,
  WARM_SECONDS,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { fixturesInSight } from "./fixtures.ts";
import { hearthEnv } from "./hearth.ts";
import { knownEntities } from "./known.ts";
import { Life } from "./life.ts";
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

/** El hogar de la casa del jugador, y lo pone parado al lado. */
function atHearth(w: LifeWorld): { id: string; space: string } {
  const mine = w.truth.get(PERSON, w.player)?.household;
  if (mine === undefined) throw new Error("sin hogar");
  const id = w.truth
    .ids(HEARTH)
    .find((h) => w.truth.get(HEARTH, h)?.holder === holderAccount(mine));
  const h = id === undefined ? undefined : w.truth.get(HEARTH, id);
  if (id === undefined || h === undefined) throw new Error("sin hogar propio");
  const node = w.spaces.spaces.find((s) => s.key === h.space);
  if (node === undefined) throw new Error("sin espacio");
  w.truth.set(LOCATION, w.player, { hex: node.hex, space: node.key });
  return { id, space: h.space };
}

/** «me caliento junto al fogón» como lo deja la gramática. */
function warm(w: LifeWorld): DraftResult {
  return planFromDraft(
    {
      kind: "act",
      plan: {
        kind: "do",
        verb: "use",
        args: [
          { role: "target", ref: { text: "el fogón", features: [] } },
          { role: "how", text: "calentarme" },
        ],
      },
    } as IntentDraft,
    {
      actor: w.player,
      source: "player",
      catalog: w.catalog,
      known: knownEntities(w),
      clock: w.clock,
      causes: [{ kind: "state", entity: w.player, key: "intent" }],
      here: w.truth.get(LOCATION, w.player)?.hex,
    },
  );
}

const ENV: ThermalEnv = { airC: 2, windMs: 0, radiantC: 0, wetness: 0, indoor: true } as never;

describe("calentarse junto al fogón (use-hearth-warm)", () => {
  it("el fogón de la casa está a la vista y «me caliento junto al fogón» es `use` con `hearth.warm`", () => {
    const life = Life.create(7, content, { hearths: true });
    const w = life.world;
    const { id } = atHearth(w);
    expect(fixturesInSight(w).find((f) => f.shape === "hearth")?.ref).toBe(id);
    const made = warm(w);
    if (made.kind !== "plan" || made.plan.root.kind !== "do") throw new Error(made.kind);
    expect(made.plan.root).toMatchObject({
      verb: "use",
      args: [
        { role: "target", entity: id },
        { role: "how", text: "hearth.warm" },
      ],
    });
  }, 300_000);

  it("con el fuego prendido se queda arrimado y queda el tramo; apagado, no hay de qué", () => {
    const life = Life.create(7, content, { hearths: true });
    const w = life.world;
    const { id } = atHearth(w);
    const row = w.truth.get(HEARTH, id as never);
    if (row === undefined) throw new Error("sin fila");
    w.truth.set(HEARTH, id as never, { ...row, intensity: 0.2 });
    expect(fixturesInSight(w).find((f) => f.shape === "hearth")?.state).toBe("lit");
    const made = warm(w);
    if (made.kind !== "plan") throw new Error(made.kind);
    const report = life.turn(made.plan, 1);
    const step = report.steps.find((s) => s.verb === "use");
    expect(step?.self.effect).toMatchObject({
      kind: "use",
      how: "hearth.warm",
      hearth: id,
      warmed: true,
    });
    const span = w.truth.get(HEARTH_WARMING, w.player);
    expect(span?.hearth).toBe(id);
    expect((span?.until ?? 0) - (span?.from ?? 0)).toBe(WARM_SECONDS);

    // Apagado: el fogón se ve frío y arrimarse falla sin escribir otro tramo.
    atHearth(w);
    w.truth.set(HEARTH, id as never, { ...row, intensity: 0 });
    expect(fixturesInSight(w).find((f) => f.shape === "hearth")?.state).toBe("cold");
    const cold = warm(w);
    if (cold.kind !== "plan") throw new Error(cold.kind);
    const again = life.turn(cold.plan, 1);
    const failed = again.steps.find((s) => s.verb === "use");
    expect(failed?.self.effect).toMatchObject({ how: "hearth.warm", warmed: false, means: false });
    expect(w.truth.get(HEARTH_WARMING, w.player)).toEqual(span);
  }, 300_000);

  it("el calor de cerca se suma solo en la parte del tramo que estuvo arrimado", () => {
    const life = Life.create(7, content, { hearths: true });
    const w = life.world;
    const { id } = atHearth(w);
    const row = w.truth.get(HEARTH, id as never);
    if (row === undefined) throw new Error("sin fila");
    w.truth.set(HEARTH, id as never, { ...row, intensity: 0.2 });
    const env = hearthEnv(w.spaces);
    const room = env(w.truth, w.player, ENV, { from: 0, to: 3600 }).radiantC;
    w.truth.set(HEARTH_WARMING, w.player, { hearth: id, from: 0, until: 1800 });
    const half = env(w.truth, w.player, ENV, { from: 0, to: 3600 }).radiantC;
    const full = env(w.truth, w.player, ENV, { from: 0, to: 1800 }).radiantC;
    const after = env(w.truth, w.player, ENV, { from: 3600, to: 7200 }).radiantC;
    expect(half).toBeGreaterThan(room);
    expect(full).toBeGreaterThan(half);
    expect(full - room).toBeCloseTo(2 * (half - room), 6);
    expect(after).toBe(room);
    // Sin tramo (quien llama sin `span`) queda como antes.
    expect(env(w.truth, w.player, ENV).radiantC).toBe(room);
  }, 300_000);
});
