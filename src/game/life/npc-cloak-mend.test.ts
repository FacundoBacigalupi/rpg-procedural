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
import { CLOAK } from "./cloak.ts";
import {
  CLOAK_MEND_COST,
  CLOAK_MEND_KEEPS,
  CLOAK_MENDED,
  CLOAK_NEW_COST,
  CLOAK_REPLACE_AT,
  CLOAK_WORN_AT,
  cloakJob,
  cloakWearAfterMend,
} from "./cloak-mend.ts";
import { optInParts } from "./create.ts";
import { engineOptions, Life } from "./life.ts";
import { FULL_PROFILE, validateLifeDependencies } from "./profile.ts";
import { living } from "./world.ts";

describe("reponer la capa (puro)", () => {
  it("nada hasta CLOAK_WORN_AT, remiendo hasta CLOAK_REPLACE_AT, capa nueva después", () => {
    expect(cloakJob(0)).toBeNull();
    expect(cloakJob(CLOAK_WORN_AT - 0.01)).toBeNull();
    expect(cloakJob(CLOAK_WORN_AT)).toEqual({ kind: "mend", cost: CLOAK_MEND_COST });
    expect(cloakJob(CLOAK_REPLACE_AT)).toEqual({ kind: "replace", cost: CLOAK_NEW_COST });
    expect(cloakJob(1)).toEqual({ kind: "replace", cost: CLOAK_NEW_COST });
  });
  it("remendar quita parte del desgaste; la capa nueva lo deja en cero", () => {
    expect(cloakWearAfterMend(0.8, "mend")).toBeCloseTo(0.8 * CLOAK_MEND_KEEPS, 6);
    expect(cloakWearAfterMend(1, "replace")).toBe(0);
  });
  it("apagado por defecto y pide la capa", () => {
    expect(optInParts({})).toEqual({});
    expect(optInParts({ npcCloak: true, npcCloakMend: true })).toEqual({
      npcCloak: true,
      npcCloakMend: true,
    });
    expect(
      validateLifeDependencies({ npcCloakMend: true }).some((i) => i.requires === "npcCloak"),
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

describe("el NPC repone su capa (opt-in)", () => {
  function run(mend: boolean) {
    const life = Life.create(7, content, {
      npcJourneyDays: 30,
      npcCloak: true,
      ...(mend ? { npcCloakMend: true } : {}),
    });
    const w = life.world;
    const adults = living(w.truth).filter(
      (x) =>
        x !== life.player && (w.truth.get(PERSON, x)?.born ?? 0) < life.now - 20 * 365 * 86_400,
    ) as AgentId[];
    const [worn, lost] = adults as [AgentId, AgentId];
    // En la aldea (con espacio), uno con la capa gastada y otro que la perdió.
    for (const who of [worn, lost]) {
      const at = w.truth.get(LOCATION, who);
      w.truth.set(LOCATION, who, { hex: at?.hex ?? 0, space: at?.space ?? "near" });
    }
    w.truth.set(CLOAK, worn, { wear: 0.8 });
    w.truth.set(CLOAK, lost, { wear: 1 });
    const coins = (who: AgentId) => w.ledger.balance(holderAccount(who as never), COPPER);
    const sinkBefore = w.ledger.balance(externalAccount(WAGES_SINK), COPPER);
    life.advanceTo(life.now + 30 * 86_400);
    return { life, w, worn, lost, coins, sinkBefore };
  }

  it("con la opción paga cobre al sumidero y repone la capa; sin ella nada cambia", () => {
    const on = run(true);
    const mended = on.w.log.all().filter((e) => e.kind === CLOAK_MENDED);
    expect(mended.length).toBeGreaterThan(0);
    const paid = mended.reduce((n, e) => n + ((e.data as { paid: number }).paid ?? 0), 0);
    expect(on.w.ledger.balance(externalAccount(WAGES_SINK), COPPER)).toBeGreaterThanOrEqual(
      on.sinkBefore + paid,
    );
    for (const e of mended) expect(e.causes.length).toBeGreaterThan(0);
    expect(on.w.truth.get(CLOAK, on.lost)?.wear).toBeLessThan(1);
    expect(on.w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: on.w.truth, log: on.w.log, ledger: on.w.ledger })).toEqual([]);

    const off = run(false);
    expect(off.w.log.all().some((e) => e.kind === CLOAK_MENDED)).toBe(false);
    expect(off.w.truth.get(CLOAK, off.lost)?.wear).toBe(1);
  }, 300_000);

  it("el perfil completo lo enciende desde life-18 y el replay anterior lo apaga", () => {
    expect(FULL_PROFILE.npcCloakMend).toBe(true);
    expect(optInParts({ npcCloak: true, npcCloakMend: true, legacyNoCloakMend: true })).toEqual({
      npcCloak: true,
    });
    expect(engineOptions("life-17", FULL_PROFILE).legacyNoCloakMend).toBe(true);
    expect(engineOptions("life-18", FULL_PROFILE).legacyNoCloakMend).toBeUndefined();
  });

  it("es determinista", () => {
    const a = run(true);
    const b = run(true);
    const key = (r: ReturnType<typeof run>) =>
      JSON.stringify([
        r.w.truth.get(CLOAK, r.worn),
        r.w.truth.get(CLOAK, r.lost),
        r.coins(r.worn),
        r.coins(r.lost),
        r.life.hash(),
      ]);
    expect(key(a)).toBe(key(b));
  }, 300_000);
});
