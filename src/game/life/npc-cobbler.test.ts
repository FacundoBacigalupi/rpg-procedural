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
import {
  COBBLER,
  HIDES_SOURCE,
  LEATHER_SCRAP,
  LEATHER_UNIT,
  leatherFor,
  leatherToFetch,
  levelAfterJob,
  mendKeeps,
  NEW_PAIR_LEATHER,
  startLevel,
} from "./cobbler.ts";
import { optInParts } from "./create.ts";
import { FOOTWEAR } from "./footwear.ts";
import { COBBLER_CHOSEN, FOOTWEAR_MENDED, LEATHER_FETCHED } from "./footwear-mend.ts";
import { engineOptions, Life } from "./life.ts";
import { FULL_PROFILE, validateLifeDependencies } from "./profile.ts";
import { living } from "./world.ts";

describe("el oficio del zapatero (puro)", () => {
  it("el oficio mejora con cada arreglo, sin pasar el techo, y el remiendo deja menos desgaste", () => {
    let level = startLevel(0);
    expect(level).toBeCloseTo(0.15, 6);
    for (let i = 0; i < 2000; i++) level = levelAfterJob(level);
    expect(level).toBeLessThanOrEqual(0.9);
    expect(level).toBeGreaterThan(0.89);
    expect(mendKeeps(1)).toBeLessThan(mendKeeps(0));
    expect(levelAfterJob(0.3)).toBeGreaterThan(0.3);
  });
  it("el cuero se junta en lotes solo cuando falta", () => {
    expect(leatherToFetch(1000, leatherFor("mend"))).toBe(0);
    expect(leatherToFetch(0, leatherFor("mend"))).toBeGreaterThanOrEqual(leatherFor("mend"));
    expect(leatherToFetch(0, NEW_PAIR_LEATHER * 10)).toBe(NEW_PAIR_LEATHER * 10);
  });
  it("apagado por defecto y pide el remiendo", () => {
    expect(optInParts({})).toEqual({});
    expect(optInParts({ npcCobbler: true, legacyNoCobbler: true })).toEqual({});
    expect(
      validateLifeDependencies({ npcCobbler: true }).some((i) => i.requires === "npcFootwearMend"),
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

describe("el zapatero de la aldea cobra y trabaja con cuero (opt-in)", () => {
  function run(cobbler: boolean) {
    const life = Life.create(7, content, {
      npcFootwear: true,
      npcFootwearMend: true,
      ...(cobbler ? { npcCobbler: true } : {}),
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
    const coins = (who: AgentId) => w.ledger.balance(holderAccount(who as never), COPPER);
    const copperBefore = adults.reduce((n, x) => n + coins(x), 0);
    life.advanceTo(life.now + 30 * 86_400);
    return { life, w, adults, coins, copperBefore };
  }

  it("elige un zapatero, le paga el cobre, gasta su cuero y su oficio sube", () => {
    const r = run(true);
    const chosen = r.w.log.all().filter((e) => e.kind === COBBLER_CHOSEN);
    expect(chosen.length).toBe(1);
    const cobbler = chosen[0]?.actors[0] as AgentId;
    expect(cobbler).not.toBe(r.life.player);
    const mended = r.w.log.all().filter((e) => e.kind === FOOTWEAR_MENDED);
    expect(mended.length).toBeGreaterThan(2);
    for (const e of mended) {
      expect(e.causes.length).toBeGreaterThan(0);
      expect((e.data as { cobbler: string }).cobbler).toBe(cobbler);
    }
    // El cobre se queda en la aldea: el sumidero de sueldos no cobra nada.
    expect(r.w.ledger.balance(externalAccount(WAGES_SINK), COPPER)).toBe(0);
    // Con cuero que entró de las pieles y se gastó en arreglos.
    const fetched = r.w.log.all().filter((e) => e.kind === LEATHER_FETCHED);
    expect(fetched.length).toBeGreaterThan(0);
    const used = mended.reduce((n, e) => n + ((e.data as { leather: number }).leather ?? 0), 0);
    expect(-r.w.ledger.balance(externalAccount(HIDES_SOURCE), LEATHER_UNIT)).toBeGreaterThanOrEqual(
      used,
    );
    expect(r.w.ledger.balance(externalAccount(LEATHER_SCRAP), LEATHER_UNIT)).toBe(used);
    // Conservación: nadie fabrica ni pierde cobre; el oficio mejora con la práctica.
    expect(r.w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: r.w.truth, log: r.w.log, ledger: r.w.ledger })).toEqual([]);
    expect(r.w.truth.get(COBBLER, cobbler)?.level ?? 0).toBeGreaterThan(0.15);
    const copperNow = r.adults.reduce((n, x) => n + r.coins(x), 0);
    expect(copperNow).toBeLessThanOrEqual(r.copperBefore);
  }, 300_000);

  it("sin la opción el cobre sigue yendo al sumidero y no hay zapatero", () => {
    const off = run(false);
    expect(off.w.log.all().some((e) => e.kind === COBBLER_CHOSEN)).toBe(false);
    expect(off.w.ledger.balance(externalAccount(WAGES_SINK), COPPER)).toBeGreaterThan(0);
  }, 300_000);

  it("sin calzado gastado no se elige zapatero (no hay eventos de más)", () => {
    const life = Life.create(7, content, {
      npcFootwear: true,
      npcFootwearMend: true,
      npcCobbler: true,
    });
    life.advanceTo(life.now + 5 * 86_400);
    expect(life.world.log.all().some((e) => e.kind === COBBLER_CHOSEN)).toBe(false);
  }, 300_000);

  it("el perfil completo lo enciende desde life-26 y el replay anterior lo apaga", () => {
    expect(FULL_PROFILE.npcCobbler).toBe(true);
    expect(engineOptions("life-25", FULL_PROFILE).legacyNoCobbler).toBe(true);
    expect(engineOptions("life-26", FULL_PROFILE).legacyNoCobbler).toBeUndefined();
  });

  it("es determinista", () => {
    const a = run(true);
    const b = run(true);
    const key = (r: ReturnType<typeof run>) =>
      JSON.stringify([
        r.adults.map((x) => [r.w.truth.get(FOOTWEAR, x), r.coins(x)]),
        r.w.log.all().filter((e) => e.kind === FOOTWEAR_MENDED).length,
      ]);
    expect(key(a)).toBe(key(b));
  }, 300_000);
});
