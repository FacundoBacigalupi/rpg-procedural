import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, loadContent } from "../../core/index.ts";
import { checkInvariants, LOCATION, outdoorTempC, PERSON, PLACE } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { CLOAK, CLOAK_CLO, carriedCloakClo } from "./cloak.ts";
import { optInParts } from "./create.ts";
import { NPC_DECISION } from "./decide.ts";
import { CLOAK_MARGIN_CLO, wantsCloak } from "./forecast.ts";
import { engineOptions, Life } from "./life.ts";
import { NPC_JOURNEY } from "./npc-verbs.ts";
import { FULL_PROFILE, validateLifeDependencies } from "./profile.ts";
import { seasonalClothing } from "./thermal.ts";
import { living } from "./world.ts";

describe("pronóstico del viajero (puro)", () => {
  it("apagado por defecto y pide la capa", () => {
    expect(optInParts({})).toEqual({});
    expect(optInParts({ npcForecast: true })).toEqual({ npcForecast: true });
    expect(
      validateLifeDependencies({ npcForecast: true }).some((i) => i.requires === "npcCloak"),
    ).toBe(true);
  });

  it("el perfil completo lo enciende desde life-19 y el replay anterior lo apaga", () => {
    expect(FULL_PROFILE.npcForecast).toBe(true);
    expect(optInParts({ npcForecast: true, legacyNoForecast: true })).toEqual({});
    expect(engineOptions("life-18", FULL_PROFILE).legacyNoForecast).toBe(true);
    expect(engineOptions("life-19", FULL_PROFILE).legacyNoForecast).toBeUndefined();
  });

  it("carga la capa solo si cree que va a necesitar bastante más abrigo del que lleva", () => {
    expect(wantsCloak(-5, 15)).toBe(true);
    expect(wantsCloak(14, 15)).toBe(false);
    expect(wantsCloak(25, 15)).toBe(false);
    const gap = seasonalClothing(-5).clo - seasonalClothing(15).clo;
    expect(gap).toBeGreaterThan(CLOAK_MARGIN_CLO);
  });

  it("la que dejó en casa no abriga; sin dato la lleva", () => {
    expect(carriedCloakClo(false, 0)).toBe(0);
    expect(carriedCloakClo(true, 0)).toBe(CLOAK_CLO);
    expect(carriedCloakClo(undefined, 0)).toBe(CLOAK_CLO);
    expect(carriedCloakClo(undefined, 0.5)).toBe(CLOAK_CLO / 2);
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

describe("el pronóstico en la vida (opt-in)", () => {
  function run(forecast: boolean) {
    const life = Life.create(7, content, {
      npcVerbs: ["move"],
      npcJourneyDays: 6,
      npcCloak: true,
      ...(forecast ? { npcForecast: true } : {}),
    });
    const w = life.world;
    const adults = living(w.truth).filter(
      (x) =>
        x !== life.player && (w.truth.get(PERSON, x)?.born ?? 0) < life.now - 20 * 365 * 86_400,
    );
    const walkers = adults.slice(0, 3) as AgentId[];
    const place = w.truth.ids(PLACE)[0] as string;
    const hexes = (w.truth.get(PLACE, place as never)?.hexes ?? []) as number[];
    let from = hexes[0] as number;
    for (let i = 0; i < 4; i++) {
      from = (w.map.neighbors[from] ?? []).find((n) => !hexes.includes(n)) ?? from;
    }
    for (const who of walkers) {
      w.truth.set(LOCATION, who, { hex: from });
      w.truth.set(NPC_DECISION, who, {
        at: life.now,
        id: `move:${place}+toward:agent:99`,
        verb: "move",
        target: place,
        utility: 1,
        options: 2,
      } as never);
    }
    life.advanceTo(life.now + 3 * 86_400);
    return { life, w, walkers };
  }

  it("al salir deja su creencia en el viaje y la capa sigue lo que creyó", () => {
    const on = run(true);
    const trips = on.walkers.flatMap((x) => {
      const t = on.w.truth.get(NPC_JOURNEY, x);
      return t ? [{ x, t }] : [];
    });
    expect(trips.length).toBeGreaterThan(0);
    for (const { x, t } of trips) {
      expect(typeof t.foreseenMinC).toBe("number");
      expect(t.cloak).toBe(
        wantsCloak(
          t.foreseenMinC as number,
          outdoorTempC(on.w.map, on.w.clock, on.w.seed, t.since),
        ),
      );
      // Quien la dejó en casa no la gasta en el camino.
      if (t.cloak === false) expect(on.w.truth.get(CLOAK, x)).toBeUndefined();
      else expect(on.w.truth.get(CLOAK, x)?.wear ?? 0).toBeGreaterThan(0);
    }
    expect(on.w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: on.w.truth, log: on.w.log, ledger: on.w.ledger })).toEqual([]);

    // Apagado, nadie pronostica y todos llevan la capa como siempre.
    const off = run(false);
    for (const x of off.walkers) {
      const t = off.w.truth.get(NPC_JOURNEY, x);
      if (t) {
        expect(t.foreseenMinC).toBeUndefined();
        expect(t.cloak).toBeUndefined();
      }
    }
  }, 300_000);

  it("es determinista", () => {
    const key = (r: ReturnType<typeof run>) =>
      JSON.stringify([r.walkers.map((x) => r.w.truth.get(NPC_JOURNEY, x)), r.life.hash()]);
    expect(key(run(true))).toBe(key(run(true)));
  }, 300_000);
});
