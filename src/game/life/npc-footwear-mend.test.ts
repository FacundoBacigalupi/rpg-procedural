import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  externalAccount,
  holderAccount,
  loadContent,
} from "../../core/index.ts";
import { COPPER, checkInvariants, LOCATION, PERSON, WAGES_SINK } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { optInParts } from "./create.ts";
import { FOOTWEAR, WORN_AT } from "./footwear.ts";
import {
  FOOTWEAR_MENDED,
  MEND_COST,
  MEND_KEEPS,
  mendJob,
  NEW_PAIR_COST,
  REPLACE_AT,
  wearAfterMend,
} from "./footwear-mend.ts";
import { engineOptions, Life } from "./life.ts";
import { FULL_PROFILE, validateLifeDependencies } from "./profile.ts";
import { living } from "./world.ts";

describe("remendar el calzado (puro)", () => {
  it("nada hasta WORN_AT, remiendo hasta REPLACE_AT, par nuevo después", () => {
    expect(mendJob(0)).toBeNull();
    expect(mendJob(WORN_AT - 0.01)).toBeNull();
    expect(mendJob(WORN_AT)).toEqual({ kind: "mend", cost: MEND_COST });
    expect(mendJob(REPLACE_AT)).toEqual({ kind: "replace", cost: NEW_PAIR_COST });
  });
  it("remendar quita parte del desgaste; el par nuevo lo deja en cero", () => {
    expect(wearAfterMend(0.8, "mend")).toBeCloseTo(0.8 * MEND_KEEPS, 6);
    expect(wearAfterMend(1, "replace")).toBe(0);
  });
  it("apagado por defecto y pide el calzado", () => {
    expect(optInParts({})).toEqual({});
    expect(optInParts({ npcFootwear: true, npcFootwearMend: true })).toEqual({
      npcFootwear: true,
      npcFootwearMend: true,
    });
    expect(
      validateLifeDependencies({ npcFootwearMend: true }).some((i) => i.requires === "npcFootwear"),
    ).toBe(true);
  });
});

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

describe("el NPC arregla su calzado gastado (opt-in)", () => {
  function run(mend: boolean) {
    const life = Life.create(7, content, {
      npcFootwear: true,
      ...(mend ? { npcFootwearMend: true } : {}),
    });
    const w = life.world;
    const adults = living(w.truth).filter(
      (x) =>
        x !== life.player && (w.truth.get(PERSON, x)?.born ?? 0) < life.now - 20 * 365 * 86_400,
    ) as AgentId[];
    const [worn, destroyed] = adults as [AgentId, AgentId];
    // En la aldea (con espacio) y con el calzado gastado / destrozado.
    for (const who of [worn, destroyed]) {
      const at = w.truth.get(LOCATION, who);
      w.truth.set(LOCATION, who, { hex: at?.hex ?? 0, space: at?.space ?? "near" });
    }
    w.truth.set(FOOTWEAR, worn, { wear: 0.8 });
    w.truth.set(FOOTWEAR, destroyed, { wear: 1 });
    const coins = (who: AgentId) => w.ledger.balance(holderAccount(who as never), COPPER);
    const before = { worn: coins(worn), destroyed: coins(destroyed) };
    const sinkBefore = w.ledger.balance(externalAccount(WAGES_SINK), COPPER);
    life.advanceTo(life.now + 30 * 86_400);
    return { life, w, worn, destroyed, before, coins, sinkBefore };
  }

  it("con la opción paga cobre al sumidero y baja el desgaste; sin ella nada cambia", () => {
    const on = run(true);
    const mended = on.w.log.all().filter((e) => e.kind === FOOTWEAR_MENDED);
    expect(mended.length).toBeGreaterThan(0);
    const paid = mended.reduce((n, e) => n + ((e.data as { paid: number }).paid ?? 0), 0);
    expect(on.w.ledger.balance(externalAccount(WAGES_SINK), COPPER)).toBeGreaterThanOrEqual(
      on.sinkBefore + paid,
    );
    for (const e of mended) expect(e.causes.length).toBeGreaterThan(0);
    expect(on.w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: on.w.truth, log: on.w.log, ledger: on.w.ledger })).toEqual([]);

    const off = run(false);
    expect(off.w.log.all().some((e) => e.kind === FOOTWEAR_MENDED)).toBe(false);
    expect(off.w.truth.get(FOOTWEAR, off.destroyed)?.wear).toBe(1);
  }, 300_000);

  it("el perfil completo lo enciende desde life-15 y el replay anterior lo apaga", () => {
    expect(FULL_PROFILE.npcFootwearMend).toBe(true);
    expect(optInParts({ npcFootwearMend: true, legacyNoFootwearMend: true })).toEqual({});
    expect(engineOptions("life-14", FULL_PROFILE).legacyNoFootwearMend).toBe(true);
    expect(engineOptions("life-15", FULL_PROFILE).legacyNoFootwearMend).toBeUndefined();
  });

  it("es determinista", () => {
    const a = run(true);
    const b = run(true);
    const key = (r: ReturnType<typeof run>) =>
      JSON.stringify([
        r.w.truth.get(FOOTWEAR, r.worn),
        r.w.truth.get(FOOTWEAR, r.destroyed),
        r.coins(r.worn),
        r.coins(r.destroyed),
      ]);
    expect(key(a)).toBe(key(b));
  }, 300_000);
});
