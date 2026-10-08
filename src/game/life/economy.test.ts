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

describe("migración de vidas guardadas antes de la economía", () => {
  it("suma las fuentes y sumideros que faltan sin tocar un saldo", async () => {
    const { Ledger } = await import("../../core/index.ts");
    const { withDeclaredExternals } = await import("./create.ts");
    const life = Life.create(7, content);
    const w = life.world;
    const { harvest, rotted, ...old } = w.ledger.config.externals;
    expect(harvest).toBeDefined();
    expect(rotted).toBeDefined();
    const oldLedger = Ledger.fromJournal({ externals: old }, w.ledger.journal());
    expect(() =>
      oldLedger.post({
        tick: 0,
        eventId: "event:99999" as never,
        transfers: [
          { unit: grain, from: externalAccount("harvest"), to: externalAccount("seed"), amount: 1 },
        ],
      }),
    ).toThrow();
    const migrated = withDeclaredExternals(oldLedger, content);
    expect(Object.keys(migrated.config.externals).sort()).toEqual(
      Object.keys(w.ledger.config.externals).sort(),
    );
    expect(migrated.total(copper)).toBe(w.ledger.total(copper));
    expect(migrated.total(grain)).toBe(w.ledger.total(grain));
    expect(migrated.audit()).toEqual([]);
    // Lo que ya declara todo no se rehace.
    expect(withDeclaredExternals(w.ledger, content)).toBe(w.ledger);
  }, 120_000);
});
