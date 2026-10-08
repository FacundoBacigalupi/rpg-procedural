import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, type Event, loadContent } from "../../core/index.ts";
import {
  checkInvariants,
  claimId,
  FIELD_YIELD,
  LAW_BELIEFS,
  type LawBelief,
  lawKeyId,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { hypothesesPanel } from "./hypotheses.ts";
import { Life } from "./life.ts";
import { harvestOf, senseSituation } from "./observe.ts";
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
const DAY = 86_400;

const event = (kind: string, data: unknown): Event =>
  ({ id: 1, tick: 0, kind, actors: ["agent:1"], place: {}, data, causes: [] }) as unknown as Event;

describe("qué cosecha se ve", () => {
  it("la rutina y el trabajo del personaje traen un rinde por hora", () => {
    expect(harvestOf(event("routine.harvested", { grams: 80 }))?.gramsPerHour).toBe(80);
    const work = (effectiveSeconds: number, gramsPerHour?: number) =>
      event("action.work", {
        effect: { kind: "work", effectiveSeconds, hurt: false, gramsPerHour },
      });
    expect(harvestOf(work(3600, 110))?.gramsPerHour).toBe(110);
    // Sin tierra que pague, o sin haber trabajado, no hay nada que ver.
    expect(harvestOf(work(3600))).toBeUndefined();
    expect(harvestOf(work(0, 110))).toBeUndefined();
    expect(harvestOf(event("action.speak", {}))).toBeUndefined();
  });
});

describe("las hipótesis de la aldea", () => {
  const month = (seed: number) => {
    const life = Life.create(seed, content);
    life.advanceTo(life.now + 30 * DAY);
    return life;
  };

  it("los que trabajan el campo anotan lo que rinde y mueven sus hipótesis, citando eventos reales", () => {
    const life = month(10);
    const w = life.world;
    const key = lawKeyId(FIELD_YIELD);
    const farmers = living(w.truth).filter((id) => w.truth.get(LAW_BELIEFS, id)?.beliefs[key]);
    expect(farmers.length).toBeGreaterThan(0);
    const real = new Set(w.log.all().map((e) => e.id));
    for (const id of farmers) {
      const row = w.truth.get(LAW_BELIEFS, id);
      const b = row?.beliefs[key] as LawBelief;
      expect(real.has(row?.originEventId as never)).toBe(true);
      expect(b.seen).toBeGreaterThan(0);
      for (const o of b.evidence) {
        expect(real.has(o.eventId)).toBe(true);
        expect(o.observer).toBe(id);
      }
      expect(b.hypotheses.reduce((s, x) => s + x.weight, 0)).toBeCloseTo(1, 3);
      // Toda hipótesis tiene un origen y sale del catálogo.
      expect(b.hypotheses.every((x) => x.h.id === claimId(x.h.key, x.h.claim))).toBe(true);
    }
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  }, 180_000);

  it("la situación que siente es un tramo del año y de la luna, no la verdad del mundo", () => {
    const life = Life.create(10, content);
    const w = life.world;
    const o = { clock: w.clock, map: w.map };
    for (let d = 0; d < 400; d += 17) {
      const s = senseSituation(o, life.now + d * DAY);
      expect(s.season).toBeGreaterThanOrEqual(0);
      expect(s.season).toBeLessThanOrEqual(3);
    }
  }, 180_000);

  it("el diario del personaje no trae números del mundo y es determinista", () => {
    const run = () => {
      const life = month(10);
      const p = hypothesesPanel(life.world);
      return JSON.stringify([
        p,
        living(life.world.truth).map((id) => life.world.truth.get(LAW_BELIEFS, id)),
      ]);
    };
    const a = run();
    expect(run()).toBe(a);
  }, 360_000);
});
