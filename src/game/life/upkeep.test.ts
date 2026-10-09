import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import { BUILDING, checkInvariants } from "../../sim/index.ts";
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

describe("mantenimiento de la aldea", () => {
  it("los edificios se gastan, un techo caído se repara por el ledger y todo cierra", () => {
    const life = Life.create(7, content, { frequency: 8 });
    const { truth, log, ledger, clock } = life.world;
    const homes = truth.ids(BUILDING).filter((id) => truth.get(BUILDING, id)?.household);
    const home = homes[0];
    const record = home && truth.get(BUILDING, home);
    if (!home || !record) throw new Error("sin casas");
    // Un techo muy gastado: el hogar tiene que arreglarlo.
    truth.set(BUILDING, home, {
      ...record,
      components: record.components.map((c) => (c.part === "roof" ? { ...c, condition: 0.2 } : c)),
    });
    const others = new Map(homes.slice(1).map((id) => [id, truth.get(BUILDING, id)]));
    life.advanceTo(life.now + 120 * clock.day);

    const repairs = log.all().filter((e) => e.kind === "settlement.repaired");
    expect(repairs.length).toBeGreaterThan(0);
    for (const e of repairs) expect(e.causes.length).toBeGreaterThan(0);
    const roof = truth.get(BUILDING, home)?.components.find((c) => c.part === "roof");
    expect(roof?.condition).toBeGreaterThan(0.3);
    expect(roof?.materials.length).toBeGreaterThan(1); // lo cambiado tiene otro origen
    const worn = [...others].some(([id, b]) =>
      truth
        .get(BUILDING, id)
        ?.components.some((c, i) => c.condition < (b?.components[i]?.condition ?? 0)),
    );
    expect(worn).toBe(true);
    expect(ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth, log, ledger })).toEqual([]);
  }, 240_000);
});
