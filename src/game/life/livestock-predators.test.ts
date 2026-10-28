import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import { ANIMAL, checkInvariants, ECOLOGY, ENTITY } from "../../sim/index.ts";
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
// Seed 4: la celda de la aldea tiene ciervos, liebres, lobos y zorros (con `frequency: 8` cae en otro sitio sin fauna).
const SEED = 4;
const OPTS = { villageLivestock: true } as const;

describe("los depredadores bajan a los corrales (livestock-predators)", () => {
  it("sin caza en el monte, lobos y zorros se llevan animales con causa; determinista", () => {
    const run = (predators: boolean) => {
      const l = Life.create(SEED, content, { ...OPTS, livestockPredators: predators });
      // Se vacía el monte de presas: los depredadores pasan hambre plena.
      const t = l.world.truth;
      const [id] = t.ids(ECOLOGY);
      const eco = id === undefined ? undefined : t.get(ECOLOGY, id);
      if (id === undefined || !eco) throw new Error("sin ecología");
      t.set(ECOLOGY, id, {
        ...eco,
        cell: {
          ...eco.cell,
          populations: eco.cell.populations.map((p) =>
            p.lineage === "deer" || p.lineage === "hare" ? { ...p, count: 0 } : p,
          ),
        },
      });
      l.advanceTo(l.now + 30 * DAY);
      return l;
    };
    const on = run(true);
    const taken = on.world.log.all().filter((e) => e.kind === "living.animal_taken");
    expect(taken.length).toBeGreaterThan(0);
    const [ecoId] = on.world.truth.ids(ECOLOGY);
    for (const e of taken) {
      const { animal, predator } = e.data as { animal: string; predator: string };
      expect(["wolf", "fox"]).toContain(predator);
      expect(e.causes).toEqual([{ kind: "state", entity: ecoId, key: "ecology" }]);
      expect(on.world.truth.get(ENTITY, animal as never)?.endEventId).toBe(e.id);
      // El zorro solo carga gallinas.
      if (predator === "fox") {
        expect(on.world.truth.get(ANIMAL, animal as never)?.species).toBe("hen");
      }
    }
    expect(on.world.ledger.audit()).toEqual([]);
    expect(
      checkInvariants({ truth: on.world.truth, log: on.world.log, ledger: on.world.ledger }),
    ).toEqual([]);
    expect(run(true).hash().total).toBe(on.hash().total);
    const off = run(false);
    expect(off.world.log.all().some((e) => e.kind === "living.animal_taken")).toBe(false);
    // Lo que se llevaron del corral engorda a los depredadores del monte (livestock-predators-credit).
    const count = (l: Life, lineage: string) => {
      const [id] = l.world.truth.ids(ECOLOGY);
      const eco = id === undefined ? undefined : l.world.truth.get(ECOLOGY, id);
      return eco?.cell.populations.find((p) => p.lineage === lineage)?.count ?? 0;
    };
    const raiders = new Set(taken.map((e) => (e.data as { predator: string }).predator));
    for (const lineage of raiders) expect(count(on, lineage)).toBeGreaterThan(count(off, lineage));
    expect(FULL_PROFILE).toMatchObject({ livestockPredators: true });
  }, 600_000);
});
