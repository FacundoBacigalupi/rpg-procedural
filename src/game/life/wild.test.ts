import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, externalAccount, loadContent } from "../../core/index.ts";
import { WILD } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";
import { FORAGE_UNIT, WILD_SOURCE, WILD_SUPPLIED_EVENT } from "./wild.ts";

const DAY = 86400;

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}

// Hash de develop (el mismo de soil.test.ts): apagado no debe moverlo.
const BASE_HASH = "b829bb7436cffc764da33660c899d578132ea796fdf7f86e47af651e5310c12f";

describe("forraje silvestre (wildHarvest)", () => {
  const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
  const run = (wildHarvest: boolean, days: number) => {
    const l = Life.create(3, content, wildHarvest ? { wildHarvest: true } : {});
    l.advanceTo(l.now + DAY * days);
    return l;
  };

  it("apagado deja el hash de develop y no declara la fuente", () => {
    const off = Life.create(3, content, {});
    expect(off.hash().total).toBe(BASE_HASH);
    expect(off.world.ledger.config.externals[WILD_SOURCE]).toBeUndefined();
  });

  it("encendido: determinista, el ledger cuadra y cada ingreso tiene evento con causa", () => {
    const a = run(true, 20);
    const b = run(true, 20);
    expect(a.hash().total).toBe(b.hash().total);
    expect(a.world.ledger.audit()).toEqual([]);
    const events = a.world.log.all().filter((e) => e.kind === WILD_SUPPLIED_EVENT);
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) expect(e.causes.length).toBeGreaterThan(0);
    const minted = -a.world.ledger.balance(externalAccount(WILD_SOURCE), FORAGE_UNIT);
    expect(minted).toBeGreaterThan(0);
    // Conservación: lo que entró al ledger es lo que salió del stock en pie (más lo que rebrotó).
    expect(a.world.ledger.total(FORAGE_UNIT)).toBeLessThanOrEqual(minted);
    const [id] = a.world.truth.ids(WILD);
    expect(a.world.truth.get(WILD, id as never)?.standing).toBeGreaterThan(0);
  });
});
