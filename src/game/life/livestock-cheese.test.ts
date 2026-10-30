import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import { checkInvariants } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { curdRulesOf } from "./create.ts";
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

describe("la leche que sobra se vuelve queso (livestock-milk-cheese)", () => {
  it("pura: la leche se cuaja en queso, una parte", () => {
    const [rule] = curdRulesOf(content);
    expect(rule?.from).toBe("good:milk");
    expect(rule?.into).toBe("good:cheese");
    expect(rule?.yield).toBeGreaterThan(0);
    expect(rule?.yield).toBeLessThan(1);
  });

  it("encendido: la casa con leche de sobra hace queso y guarda la de su gente; apagado, no; determinista", () => {
    const run = (cheese: boolean) => {
      const l = Life.create(7, content, {
        frequency: 8,
        villageLivestock: true,
        livestockLife: true,
        livestockYield: true,
        livestockDairy: true,
        livestockCheese: cheese,
      });
      l.advanceTo(l.now + 200 * DAY);
      return l;
    };
    const on = run(true);
    const w = on.world;
    const made = w.log.all().filter((e) => e.kind === "living.cheese_made");
    expect(made.length).toBeGreaterThan(0);
    const [rule] = curdRulesOf(content);
    for (const e of made) {
      const d = e.data as { used: number; grams: number };
      expect(d.used).toBeGreaterThanOrEqual(rule?.minGrams ?? 0);
      expect(d.grams).toBe(Math.floor(d.used * (rule?.yield ?? 0)));
    }
    const off = run(false);
    expect(off.world.log.all().some((e) => e.kind === "living.cheese_made")).toBe(false);
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
    expect(run(true).hash().total).toBe(on.hash().total);
    expect(FULL_PROFILE).toMatchObject({ livestockCheese: true });
  }, 600_000);
});
