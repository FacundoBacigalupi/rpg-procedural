import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import { BUILDING, checkInvariants, ENTITY } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";

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

describe("fuego en la aldea", () => {
  it("una casa que arde pierde materia por el ledger, cita su causa y el ledger cierra", () => {
    const life = Life.create(7, content, { frequency: 8 });
    const { truth, log, ledger, clock } = life.world;
    const home = truth.ids(BUILDING).find((id) => truth.get(BUILDING, id)?.household);
    const record = home && truth.get(BUILDING, home);
    if (!home || !record) throw new Error("sin casas");
    const grams0 = record.components.reduce(
      (n, c) => n + c.materials.reduce((t, l) => t + l.grams, 0),
      0,
    );
    truth.set(BUILDING, home, {
      ...record,
      fire: { intensity: 0.9, cause: "arson", grams0, since: life.now, last: record.builtBy },
    });
    life.advanceTo(life.now + 30 * clock.day);

    const burns = log.all().filter((e) => e.kind === "settlement.burned");
    expect(burns.length).toBeGreaterThan(0);
    for (const e of burns) expect(e.causes.length).toBeGreaterThan(0);
    const after = truth.get(BUILDING, home);
    const left = after?.components.reduce(
      (n, c) => n + c.materials.reduce((t, l) => t + l.grams, 0),
      0,
    );
    expect(truth.get(ENTITY, home)?.endedAt !== undefined || (left ?? 0) < grams0).toBe(true);
    expect(ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth, log, ledger })).toEqual([]);
  }, 240_000);
});
