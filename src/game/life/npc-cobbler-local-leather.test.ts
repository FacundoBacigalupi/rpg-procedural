import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  externalAccount,
  type HolderRef,
  holderAccount,
  loadContent,
} from "../../core/index.ts";
import { BUILDING, checkInvariants, LOCATION, PERSON } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { HIDES_SOURCE, LEATHER_UNIT, localLeatherBuys } from "./cobbler.ts";
import { FOOTWEAR } from "./footwear.ts";
import { LEATHER_BOUGHT, LEATHER_FETCHED } from "./footwear-mend.ts";
import { Life } from "./life.ts";
import { FULL_PROFILE, validateLifeDependencies } from "./profile.ts";
import { living } from "./world.ts";

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
const A = "household:1" as HolderRef;
const B = "household:2" as HolderRef;

describe("el zapatero compra el cuero de las casas (livestock-hide-tan-sell, opt-in)", () => {
  it("la compra es pura: en orden, hasta lo que quiere y lo que le alcanza", () => {
    expect(
      localLeatherBuys(
        [
          { holder: A, grams: 1200 },
          { holder: B, grams: 5000 },
        ],
        3000,
        10,
      ),
    ).toEqual([
      { holder: A, grams: 1200, cost: 2 },
      { holder: B, grams: 1800, cost: 2 },
    ]);
    // Con un solo cobre compra hasta un kilo.
    expect(localLeatherBuys([{ holder: A, grams: 5000 }], 3000, 1)).toEqual([
      { holder: A, grams: 1000, cost: 1 },
    ]);
    expect(localLeatherBuys([{ holder: A, grams: 5000 }], 3000, 0)).toEqual([]);
    expect(localLeatherBuys([], 3000, 10)).toEqual([]);
    expect(
      validateLifeDependencies({ npcCobblerLocalLeather: true }).some(
        (i) => i.requires === "npcCobbler",
      ),
    ).toBe(true);
    expect(FULL_PROFILE).toMatchObject({ npcCobblerLocalLeather: true });
  });

  function run(local: boolean) {
    const life = Life.create(7, content, {
      npcFootwear: true,
      npcFootwearMend: true,
      npcCobbler: true,
      ...(local ? { npcCobblerLocalLeather: true } : {}),
    });
    const w = life.world;
    // Una casa con cuero curtido (de fuera, para el test: el curtido real tarda 45 días).
    const house = [...w.truth.ids(BUILDING)]
      .sort()
      .map((id) => w.truth.get(BUILDING, id)?.household)
      .find((h) => h !== undefined) as HolderRef | undefined;
    if (house === undefined) throw new Error("sin casa");
    const last = w.log.all().at(-1);
    if (!last) throw new Error("sin eventos");
    w.ledger.post({
      tick: life.now,
      eventId: last.id,
      transfers: [
        {
          unit: LEATHER_UNIT,
          from: externalAccount(HIDES_SOURCE),
          to: holderAccount(house),
          amount: 5000,
        },
      ],
    });
    const adults = living(w.truth).filter(
      (x) => x !== life.player && (w.truth.get(PERSON, x)?.born ?? 0) < life.now - 20 * 365 * DAY,
    ) as AgentId[];
    for (const who of adults.slice(0, 8)) {
      const at = w.truth.get(LOCATION, who);
      w.truth.set(LOCATION, who, { hex: at?.hex ?? 0, space: at?.space ?? "near" });
      w.truth.set(FOOTWEAR, who, { wear: 0.8 });
    }
    life.advanceTo(life.now + 30 * DAY);
    return { life, w, house };
  }

  it("el cuero de la casa pasa al zapatero y el cobre a la casa; sin la opción, nada", () => {
    const on = run(true);
    const bought = on.w.log.all().filter((e) => e.kind === LEATHER_BOUGHT);
    expect(bought.length).toBeGreaterThan(0);
    const grams = bought.reduce((n, e) => n + (e.data as { grams: number }).grams, 0);
    const paid = bought.reduce((n, e) => n + (e.data as { paid: number }).paid, 0);
    expect(grams).toBeGreaterThan(0);
    expect(paid).toBeGreaterThan(0);
    expect(bought.every((e) => (e.data as { from: string }).from === on.house)).toBe(true);
    // El cuero se echa a perder despacio (`ROTTED`): queda lo no vendido, menos un poco.
    const kept = on.w.ledger.balance(holderAccount(on.house), LEATHER_UNIT);
    expect(kept).toBeLessThanOrEqual(5000 - grams);
    expect(kept).toBeGreaterThan(5000 - grams - 100);
    expect(on.w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: on.w.truth, log: on.w.log, ledger: on.w.ledger })).toEqual([]);
    const off = run(false);
    expect(off.w.log.all().some((e) => e.kind === LEATHER_BOUGHT)).toBe(false);
    expect(off.w.log.all().some((e) => e.kind === LEATHER_FETCHED)).toBe(true);
    expect(off.w.ledger.balance(holderAccount(off.house), LEATHER_UNIT)).toBeGreaterThan(4900);
  }, 300_000);

  it("es determinista", () => {
    const key = (r: ReturnType<typeof run>) =>
      JSON.stringify(
        r.w.log
          .all()
          .filter((e) => e.kind === LEATHER_BOUGHT || e.kind === LEATHER_FETCHED)
          .map((e) => e.data),
      );
    expect(key(run(true))).toBe(key(run(true)));
  }, 300_000);
});
