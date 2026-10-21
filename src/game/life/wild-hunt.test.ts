import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, externalAccount, loadContent } from "../../core/index.ts";
import { ECOLOGY } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { GAME_UNIT, HUNT_SOURCE, HUNTED_EVENT } from "./ecology.ts";
import { Life } from "./life.ts";

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

// Hash de develop (el mismo de wild.test.ts): apagado no debe moverlo.
const BASE_HASH = "b829bb7436cffc764da33660c899d578132ea796fdf7f86e47af651e5310c12f";

describe("caza contra las poblaciones (wildHunt)", () => {
  const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
  const run = (hunt: boolean, days: number) => {
    const l = Life.create(4, content, hunt ? { wildHunt: true, wildHuntScale: 40 } : {});
    l.advanceTo(l.now + DAY * days);
    return l;
  };
  const deer = (l: Life) => {
    const [id] = l.world.truth.ids(ECOLOGY);
    const cell = id === undefined ? undefined : l.world.truth.get(ECOLOGY, id)?.cell;
    return cell?.populations.find((p) => p.lineage === "deer")?.count ?? 0;
  };

  it("apagado deja el hash de develop y no declara la fuente", () => {
    const off = Life.create(3, content, {});
    expect(off.hash().total).toBe(BASE_HASH);
    expect(off.world.ledger.config.externals[HUNT_SOURCE]).toBeUndefined();
  });

  it("encendido: determinista, individuos enteros con evento y causa, carne conservada y menos presas", () => {
    const a = run(true, 40);
    const b = run(true, 40);
    expect(a.hash().total).toBe(b.hash().total);
    expect(a.world.ledger.audit()).toEqual([]);
    const events = a.world.log.all().filter((e) => e.kind === HUNTED_EVENT);
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) expect(e.causes.length).toBeGreaterThan(0);
    let taken = 0;
    for (const e of events) {
      const t = (e.data as { taken: Record<string, number> }).taken;
      for (const n of Object.values(t)) {
        expect(Number.isInteger(n)).toBe(true);
        taken += n;
      }
    }
    expect(taken).toBeGreaterThan(0);
    expect(-a.world.ledger.balance(externalAccount(HUNT_SOURCE), GAME_UNIT)).toBeGreaterThan(0);
    expect(deer(a)).toBeLessThan(deer(run(false, 40)));
  }, 240_000);
});
