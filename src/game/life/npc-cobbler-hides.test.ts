import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  externalAccount,
  loadContent,
} from "../../core/index.ts";
import { COPPER, checkInvariants, LOCATION, PERSON, WAGES_SINK } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { hideBuy, hidePrice } from "./cobbler.ts";
import { FOOTWEAR } from "./footwear.ts";
import { LEATHER_FETCHED } from "./footwear-mend.ts";
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

describe("el zapatero paga la piel con su cobre (npc-b2b3b2b3b1, opt-in)", () => {
  it("el precio y la compra son puros: lote si alcanza, lo justo si no, nada si ni eso", () => {
    expect(hidePrice(3000)).toBe(3);
    expect(hideBuy(1000, 200, 0)).toEqual({ grams: 0, cost: 0 });
    expect(hideBuy(0, 200, 10)).toEqual({ grams: 3000, cost: 3 });
    expect(hideBuy(0, 200, 1)).toEqual({ grams: 200, cost: 1 });
    expect(hideBuy(0, 200, 0)).toBeNull();
    expect(
      validateLifeDependencies({ npcCobblerHides: true }).some((i) => i.requires === "npcCobbler"),
    ).toBe(true);
    expect("npcCobblerHides" in FULL_PROFILE).toBe(false);
  });

  function run(hides: boolean) {
    const life = Life.create(7, content, {
      npcFootwear: true,
      npcFootwearMend: true,
      npcCobbler: true,
      ...(hides ? { npcCobblerHides: true } : {}),
    });
    const w = life.world;
    const adults = living(w.truth).filter(
      (x) =>
        x !== life.player && (w.truth.get(PERSON, x)?.born ?? 0) < life.now - 20 * 365 * 86_400,
    ) as AgentId[];
    for (const who of adults.slice(0, 8)) {
      const at = w.truth.get(LOCATION, who);
      w.truth.set(LOCATION, who, { hex: at?.hex ?? 0, space: at?.space ?? "near" });
      w.truth.set(FOOTWEAR, who, { wear: 0.8 });
    }
    life.advanceTo(life.now + 30 * 86_400);
    return { life, w };
  }

  it("la piel cuesta cobre al sumidero y queda en el evento; sin la opción es gratis", () => {
    const on = run(true);
    const fetched = on.w.log.all().filter((e) => e.kind === LEATHER_FETCHED);
    expect(fetched.length).toBeGreaterThan(0);
    const paid = fetched.reduce((n, e) => n + ((e.data as { paid: number }).paid ?? 0), 0);
    expect(paid).toBeGreaterThan(0);
    expect(on.w.ledger.balance(externalAccount(WAGES_SINK), COPPER)).toBe(paid);
    expect(on.w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: on.w.truth, log: on.w.log, ledger: on.w.ledger })).toEqual([]);
    const off = run(false);
    expect(off.w.ledger.balance(externalAccount(WAGES_SINK), COPPER)).toBe(0);
  }, 300_000);

  it("es determinista", () => {
    const key = (r: ReturnType<typeof run>) =>
      JSON.stringify(
        r.w.log
          .all()
          .filter((e) => e.kind === LEATHER_FETCHED)
          .map((e) => e.data),
      );
    expect(key(run(true))).toBe(key(run(true)));
  }, 300_000);
});
