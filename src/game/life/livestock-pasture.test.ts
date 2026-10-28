import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import { checkInvariants, ECOLOGY, GRAZED, pastureCover } from "../../sim/index.ts";
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
// Seed 4: la celda tiene fauna (con `frequency: 8` la aldea cae en otro sitio sin herbívoros).
const SEED = 4;
const OPTS = { villageLivestock: true, livestockFeed: true } as const;

describe("el ganado pasta (livestock-feed-pasture)", () => {
  it("pura: cubre lo que alcanza, hasta todo", () => {
    expect(pastureCover(0, 10)).toBe(0);
    expect(pastureCover(5, 10)).toBe(0.5);
    expect(pastureCover(50, 10)).toBe(1);
    expect(pastureCover(5, 0)).toBe(0);
  });

  it("encendido: la casa pone menos, la comida cita el pasto, el monte pierde lo pastado; determinista", () => {
    const run = (pasture: boolean) => {
      const l = Life.create(SEED, content, { ...OPTS, livestockPasture: pasture });
      l.advanceTo(l.now + 20 * DAY);
      return l;
    };
    const fedGrams = (l: Life) =>
      l.world.log
        .all()
        .filter((e) => e.kind === "living.animal_fed")
        .reduce(
          (n, e) =>
            n +
            Object.values((e.data as { grams: Record<string, number> }).grams).reduce(
              (a, b) => a + b,
              0,
            ),
          0,
        );
    const on = run(true);
    const t = on.world.truth;
    const [ecoId] = t.ids(ECOLOGY);
    if (ecoId === undefined) throw new Error("sin ecología");
    const grazed = t.get(GRAZED, ecoId)?.kgPerDay ?? 0;
    expect(grazed).toBeGreaterThan(0);
    const fed = on.world.log.all().filter((e) => e.kind === "living.animal_fed");
    expect(fed.some((e) => e.causes.some((c) => c.kind === "state" && c.key === "pasture"))).toBe(
      true,
    );
    expect(on.world.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: t, log: on.world.log, ledger: on.world.ledger })).toEqual([]);
    expect(run(true).hash().total).toBe(on.hash().total);
    const off = run(false);
    expect(off.world.truth.ids(GRAZED)).toEqual([]);
    expect(fedGrams(on)).toBeLessThan(fedGrams(off));
    // Lo pastado sale de lo que la celda le da al monte.
    const productivity = (l: Life) => {
      const [id] = l.world.truth.ids(ECOLOGY);
      return id === undefined ? 0 : (l.world.truth.get(ECOLOGY, id)?.cell.productivity ?? 0);
    };
    expect(productivity(on)).toBeLessThan(productivity(off));
    expect(FULL_PROFILE).toMatchObject({ livestockPasture: true });
  }, 600_000);
});
