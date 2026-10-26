import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, type EntityRef, loadContent } from "../../core/index.ts";
import {
  checkInvariants,
  type DraftResult,
  ENTITY,
  type IntentDraft,
  LOCATION,
  planFromDraft,
  VILLAGE_SQUARE,
  WORK,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { fixturesInSight } from "./fixtures.ts";
import { knownEntities } from "./known.ts";
import { Life } from "./life.ts";
import { FULL_PROFILE } from "./profile.ts";
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

const benches = (w: LifeWorld) =>
  [...w.truth.ids(WORK)].filter((id) => w.truth.get(WORK, id)?.kind === "bench");

/** Lleva al personaje a la plaza (el hex del banco). */
function toSquare(w: LifeWorld): EntityRef {
  const bench = benches(w)[0];
  const hex = bench === undefined ? undefined : w.truth.get(WORK, bench)?.hexes[0];
  if (bench === undefined || hex === undefined) throw new Error("sin banco");
  w.truth.set(LOCATION, w.player, { hex, space: VILLAGE_SQUARE });
  return bench as EntityRef;
}

/** «me siento en el banco» como lo deja la gramática. */
function sit(w: LifeWorld): DraftResult {
  return planFromDraft(
    {
      kind: "act",
      plan: {
        kind: "do",
        verb: "use",
        args: [
          { role: "target", ref: { text: "el banco", kind: "object", features: [] } },
          { role: "how", text: "sentarme" },
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

describe("el banco de la plaza (fixtures-bench)", () => {
  it("sin la opción no hay banco; con ella, uno de madera puesto por los fundadores", () => {
    expect(benches(Life.create(7, content, { frequency: 8 }).world)).toEqual([]);
    const w = Life.create(7, content, { frequency: 8, squareBench: true }).world;
    const [bench] = benches(w);
    if (bench === undefined) throw new Error("sin banco");
    const row = w.truth.get(WORK, bench);
    expect(row).toMatchObject({ type: "square-bench", capacity: 0 });
    expect(row?.materials.map((m) => m.material)).toEqual(["timber"]);
    const origin = w.truth.get(ENTITY, bench)?.originEventId;
    const built = w.log.all().find((e) => e.id === origin);
    expect(built?.kind).toBe("settlement.built");
    expect(built?.causes.length).toBeGreaterThan(0);
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
    expect(FULL_PROFILE).toMatchObject({ squareBench: true });
  }, 300_000);

  it("en la plaza se ve junto al pozo y «me siento en el banco» se sienta un rato", () => {
    const life = Life.create(7, content, { frequency: 8, squareBench: true });
    const w = life.world;
    const bench = toSquare(w);
    expect(fixturesInSight(w).map((f) => f.shape)).toContain("bench");
    const made = sit(w);
    if (made.kind !== "plan" || made.plan.root.kind !== "do") throw new Error(made.kind);
    expect(made.plan.root).toMatchObject({
      verb: "use",
      args: [
        { role: "target", entity: bench },
        { role: "how", text: "bench.sit" },
      ],
    });
    const report = life.turn(made.plan, 1);
    const step = report.steps.find((s) => s.verb === "use");
    expect(step?.self.effect).toMatchObject({ kind: "use", how: "bench.sit", bench, sat: true });
  }, 300_000);
});
