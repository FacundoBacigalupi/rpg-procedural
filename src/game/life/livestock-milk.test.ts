import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import { ANIMAL, checkInvariants, herdSpecies, LACTATING, LIVESTOCK } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";
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
const DAY = 86_400;
const OPTS = {
  frequency: 8,
  villageLivestock: true,
  livestockLife: true,
  livestockYield: true,
} as const;

describe("las cabras dan leche después de parir (livestock-yield-milk)", () => {
  it("pura: las lecheras solo llegan con su opción", () => {
    const all = content.all(LIVESTOCK);
    expect(herdSpecies(all, new Set()).map((s) => s.id)).not.toContain("goat");
    expect(herdSpecies(all, new Set(["dairy"])).map((s) => s.id)).toContain("goat");
  });

  it("encendido: la leche sale de cabras que parieron hace poco; apagado, no hay cabras", () => {
    const run = (dairy: boolean) => {
      const l = Life.create(7, content, { ...OPTS, livestockDairy: dairy });
      l.advanceTo(l.now + 150 * DAY);
      return l;
    };
    const on = run(true);
    const w = on.world;
    const goats = w.truth.ids(ANIMAL).filter((id) => w.truth.get(ANIMAL, id)?.species === "goat");
    expect(goats.length).toBeGreaterThan(0);
    const births = w.log
      .all()
      .filter(
        (e) =>
          e.kind === "living.animal_born" && (e.data as { species: string }).species === "goat",
      );
    expect(births.length).toBeGreaterThan(0);
    const milk = w.log
      .all()
      .filter(
        (e) => e.kind === "living.animal_yield" && (e.data as { good: string }).good === "milk",
      );
    expect(milk.length).toBeGreaterThan(0);
    // Cada cabra que dio leche había parido antes, ese mismo día o hasta 240 días atrás.
    for (const e of milk) {
      for (const id of (e.data as { from: string[] }).from) {
        const born = births.filter(
          (b) => (b.data as { mother: string }).mother === id && b.tick <= e.tick,
        );
        expect(born.length).toBeGreaterThan(0);
        expect(w.truth.get(ANIMAL, id as never)).toMatchObject({ species: "goat", sex: "female" });
      }
    }
    for (const b of births) {
      const mother = (b.data as { mother: string }).mother;
      expect(w.truth.get(LACTATING, mother as never)?.since).toBeGreaterThanOrEqual(b.tick);
    }
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
    expect(run(true).hash().total).toBe(on.hash().total);
    const off = run(false);
    const offGoats = off.world.truth
      .ids(ANIMAL)
      .filter((id) => off.world.truth.get(ANIMAL, id)?.species === "goat");
    expect(offGoats).toEqual([]);
    expect(off.world.truth.ids(LACTATING)).toEqual([]);
    expect(FULL_PROFILE).toMatchObject({ livestockDairy: true });
  }, 600_000);
});
