import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, type EntityRef, loadContent } from "../../core/index.ts";
import { BODY_STATE, checkInvariants, PERSON } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { optInParts } from "./create.ts";
import { Life } from "./life.ts";
import { assertLifeDependencies, validateLifeDependencies } from "./profile.ts";

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

describe("opciones de crecimiento (opt-in)", () => {
  it("sin pedirlas no hay nada; pedidas, pasan a LifeParts", () => {
    expect(optInParts({})).toEqual({});
    expect(optInParts({ adultGrowth: false, gradualGrowth: false, growthSequelae: false })).toEqual(
      {},
    );
    expect(optInParts({ growthSequelae: true, adultGrowth: true, gradualGrowth: true })).toEqual({
      growthSequelae: true,
      adultGrowth: true,
      gradualGrowth: true,
    });
  });

  it("gradualGrowth exige adultGrowth", () => {
    expect(validateLifeDependencies({ gradualGrowth: true })).toEqual([
      expect.objectContaining({ option: "gradualGrowth", requires: "adultGrowth" }),
    ]);
    expect(() => assertLifeDependencies({ gradualGrowth: true, adultGrowth: true })).not.toThrow();
  });

  it("en la aldea los menores se ajustan a su talla, es determinista y no rompe invariantes", () => {
    const opts = { frequency: 8, adultGrowth: true, gradualGrowth: true, growthSequelae: true };
    const run = (o: object) => {
      const life = Life.create(7, content, o);
      life.advanceTo(life.now + 30 * DAY);
      return life;
    };
    const a = run(opts);
    const b = run(opts);
    expect(a.hash()).toEqual(b.hash());
    const base = run({ frequency: 8 });
    const masses = (l: Life) =>
      l.world.truth
        .ids(PERSON)
        .map((id) => l.world.truth.get(BODY_STATE, id as unknown as EntityRef)?.massKg ?? 0);
    expect(masses(a)).not.toEqual(masses(base));
    expect(a.world.ledger.audit()).toEqual([]);
    expect(
      checkInvariants({ truth: a.world.truth, log: a.world.log, ledger: a.world.ledger }),
    ).toEqual([]);
  });
});
