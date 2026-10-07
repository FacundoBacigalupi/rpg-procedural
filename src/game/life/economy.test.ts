import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, externalAccount, ledgerUnit, loadContent } from "../../core/index.ts";
import { GAME_CONTENT_KINDS } from "../index.ts";
import { Life } from "./index.ts";

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
const grain = ledgerUnit("good:grain");
const copper = ledgerUnit("coin:copper");

describe("economía mínima en la aldea", () => {
  it("cosecha, pudre y conserva: lo que entra y sale pasa por fuentes y sumideros con evento", () => {
    const life = Life.create(7, content);
    const w = life.world;
    const coins = w.ledger.total(copper);
    expect(coins).toBeGreaterThan(0);
    life.advanceTo(life.now + 20 * w.clock.day);
    expect(w.ledger.audit()).toEqual([]);
    // Las monedas no se crean ni se pudren: el cobre del arranque es todo el cobre.
    expect(w.ledger.total(copper)).toBe(coins);
    const kinds = new Set(w.log.all().map((e) => e.kind));
    expect(kinds.has("routine.harvested")).toBe(true);
    expect(kinds.has("household.spoiled")).toBe(true);
    // Lo cosechado y lo podrido se ven como saldos de las cuentas externas.
    expect(w.ledger.balance(externalAccount("harvest"), grain)).toBeLessThan(0);
    expect(w.ledger.balance(externalAccount("rotted"), grain)).toBeGreaterThan(0);
  }, 120_000);

  it("es determinista: la misma semilla da el mismo mundo", () => {
    const run = () => {
      const life = Life.create(7, content);
      life.advanceTo(life.now + 10 * life.world.clock.day);
      return life.hash();
    };
    expect(run()).toEqual(run());
  }, 120_000);
});
