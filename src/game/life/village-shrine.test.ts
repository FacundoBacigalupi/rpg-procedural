import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import { BUILDING, checkInvariants, ENTITY } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
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

const ofType = (w: LifeWorld, type: string) =>
  [...w.truth.ids(BUILDING)].filter((id) => w.truth.get(BUILDING, id)?.type === type);

describe("el santuario de la aldea (village-shrine)", () => {
  it("sin la opción no hay; con ella, uno comunal levantado por los fundadores, sin mover las casas", () => {
    const plain = Life.create(7, content, { frequency: 8 }).world;
    expect(ofType(plain, "shrine")).toEqual([]);
    const w = Life.create(7, content, { frequency: 8, villageShrine: true }).world;
    const shrines = ofType(w, "shrine");
    expect(shrines).toHaveLength(1);
    const [id] = shrines;
    if (id === undefined) throw new Error("sin santuario");
    const b = w.truth.get(BUILDING, id);
    expect(b?.household).toBeUndefined();
    expect(b?.owner).toEqual({ kind: "settlement", settlement: b?.settlement });
    const origin = w.truth.get(ENTITY, id)?.originEventId;
    const built = w.log.all().find((e) => e.id === origin);
    expect(built?.kind).toBe("settlement.built");
    expect(built?.causes.length).toBeGreaterThan(0);
    // Las casas de siempre quedan con el mismo id y en el mismo lugar.
    for (const h of [...plain.truth.ids(BUILDING)]) {
      expect(w.truth.get(BUILDING, h)?.at).toEqual(plain.truth.get(BUILDING, h)?.at);
      expect(w.truth.get(BUILDING, h)?.type).toBe(plain.truth.get(BUILDING, h)?.type);
    }
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
    expect(FULL_PROFILE).toMatchObject({ villageShrine: true });
  }, 300_000);
});
