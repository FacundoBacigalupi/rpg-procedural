import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import { ANIMAL, BUILDING, checkInvariants, ENTITY, LOCATION } from "../../sim/index.ts";
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

describe("el ganado de la aldea (livestock-herd)", () => {
  it("sin la opción no hay animales; con ella, cada casa trae los suyos con origen y dueño", () => {
    expect([...Life.create(7, content, { frequency: 8 }).world.truth.ids(ANIMAL)]).toEqual([]);
    const w = Life.create(7, content, { frequency: 8, villageLivestock: true }).world;
    const animals = [...w.truth.ids(ANIMAL)];
    expect(animals.length).toBeGreaterThan(0);
    const species = new Set<string>();
    for (const id of animals) {
      const a = w.truth.get(ANIMAL, id);
      if (a === undefined) throw new Error("sin fila");
      species.add(a.species);
      const home = w.truth.get(BUILDING, a.home);
      expect(home?.household).toBe(a.owner);
      expect(w.truth.get(LOCATION, id)).toEqual({ hex: home?.hex });
      const origin = w.truth.get(ENTITY, id)?.originEventId;
      const brought = w.log.all().find((e) => e.id === origin);
      expect(brought?.kind).toBe("settlement.livestock_brought");
      expect(brought?.causes).toEqual([{ kind: "event", event: home?.builtBy }]);
      expect(a.bornAt).toBeLessThanOrEqual(w.truth.get(ENTITY, id)?.createdAt ?? 0);
    }
    expect(species.has("hen")).toBe(true);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
    expect(FULL_PROFILE).toMatchObject({ villageLivestock: true });
  }, 300_000);

  it("es determinista: mismo seed, mismo ganado", () => {
    const a = Life.create(7, content, { frequency: 8, villageLivestock: true }).world;
    const b = Life.create(7, content, { frequency: 8, villageLivestock: true }).world;
    const rows = (w: typeof a) => [...w.truth.ids(ANIMAL)].map((id) => w.truth.get(ANIMAL, id));
    expect(rows(b)).toEqual(rows(a));
  }, 300_000);
});
