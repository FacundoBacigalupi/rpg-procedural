import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, loadContent, Rng } from "../../core/index.ts";
import { BODY_STATE, checkInvariants, hexPath, LOCATION, PERSON, PLACE } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { optInParts } from "./create.ts";
import { NPC_DECISION } from "./decide.ts";
import {
  FOOT_SORE_PER_HOUR,
  FOOTWEAR,
  FOOTWEAR_LIFE_SECONDS,
  footSoreBlow,
  footSoreChance,
  footwearWalkFactor,
  ROUGH_WEAR,
  WORN_AT,
  WORN_EXTRA,
  wearAfter,
} from "./footwear.ts";
import { engineOptions, Life } from "./life.ts";
import { FULL_PROFILE } from "./profile.ts";
import { living } from "./world.ts";

describe("calzado del viajero (puro)", () => {
  it("apagado por defecto: sin la opción no pasa nada al mundo", () => {
    expect(optInParts({})).toEqual({});
    expect(optInParts({ npcFootwear: false })).toEqual({});
    expect(optInParts({ npcFootwear: true })).toEqual({ npcFootwear: true });
  });

  it("se gasta con la marcha, más por monte, y nunca pasa de destrozado", () => {
    expect(wearAfter(0, FOOTWEAR_LIFE_SECONDS / 4, false)).toBe(0.25);
    expect(wearAfter(0, FOOTWEAR_LIFE_SECONDS / 4, true)).toBe(0.25 * ROUGH_WEAR);
    expect(wearAfter(0.9, FOOTWEAR_LIFE_SECONDS, false)).toBe(1);
    expect(wearAfter(0.3, 0, true)).toBe(0.3);
    expect(wearAfter(0.3, Number.NaN, true)).toBe(0.3);
  });

  it("gastado cuesta más caminar: nuevo no cambia nada", () => {
    expect(footwearWalkFactor(undefined)).toBe(1);
    expect(footwearWalkFactor(0)).toBe(1);
    expect(footwearWalkFactor(1)).toBe(1 + WORN_EXTRA);
    expect(footwearWalkFactor(5)).toBe(1 + WORN_EXTRA);
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

describe("las llagas del calzado destrozado (puro)", () => {
  const rng = Rng.root(5);
  it("sin pasar de WORN_AT o sin marcha no hay chance", () => {
    expect(footSoreChance(0, 3600)).toBe(0);
    expect(footSoreChance(WORN_AT, 3600)).toBe(0);
    expect(footSoreChance(1, 0)).toBe(0);
    expect(footSoreChance(1, Number.NaN)).toBe(0);
  });
  it("crece con el desgaste y las horas, y no pasa de 1", () => {
    expect(footSoreChance(1, 3600)).toBe(FOOT_SORE_PER_HOUR);
    expect(footSoreChance(0.85, 3600)).toBeCloseTo(FOOT_SORE_PER_HOUR / 2, 6);
    expect(footSoreChance(1, 10_000 * 3600)).toBe(1);
  });
  it("la llaga es leve, de pierna, y sin chance no hay golpe", () => {
    expect(footSoreBlow(0.2, 3600, rng.fork("a"), "e:1" as never, 0)).toBeNull();
    const blow = footSoreBlow(1, 10_000 * 3600, rng.fork("b"), "e:1" as never, 9);
    expect(blow?.kind).toBe("cut");
    expect(["left_leg", "right_leg"]).toContain(blow?.zone);
    expect(blow?.force).toBeLessThan(0.2);
    expect(blow?.at).toBe(9);
  });
  it("apagado por defecto", () => {
    expect(optInParts({ npcFootSores: true })).toEqual({ npcFootSores: true });
    expect(optInParts({})).toEqual({});
  });
  it("el perfil completo lo enciende desde life-14 y el replay anterior lo apaga", () => {
    expect(FULL_PROFILE.npcFootSores).toBe(true);
    expect(optInParts({ npcFootSores: true, legacyNoFootSores: true })).toEqual({});
    expect(engineOptions("life-13", FULL_PROFILE).legacyNoFootSores).toBe(true);
    expect(engineOptions("life-14", FULL_PROFILE).legacyNoFootSores).toBeUndefined();
  });
});

describe("el viajero con el calzado destrozado se lastima (opt-in)", () => {
  function march(footSores: boolean) {
    const life = Life.create(7, content, {
      npcVerbs: ["move"],
      npcJourneyDays: 6,
      npcFootwear: true,
      ...(footSores ? { npcFootSores: true } : {}),
    });
    const w = life.world;
    const adults = living(w.truth).filter(
      (x) =>
        x !== life.player && (w.truth.get(PERSON, x)?.born ?? 0) < life.now - 20 * 365 * 86_400,
    );
    const walkers = adults.slice(0, 6) as AgentId[];
    const place = w.truth.ids(PLACE)[0] as string;
    const hexes = (w.truth.get(PLACE, place as never)?.hexes ?? []) as number[];
    let from = hexes[0] as number;
    for (let i = 0; i < 4; i++) {
      from =
        (w.map.neighbors[from] ?? []).find(
          (n) => !hexes.includes(n) && hexPath(w.map, n, hexes[0] as number).length > i,
        ) ?? from;
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
      w.truth.set(FOOTWEAR, who, { wear: 1 });
    }
    life.advanceTo(life.now + 4 * 86_400);
    const sores = walkers.flatMap((who) =>
      (w.truth.get(BODY_STATE, who)?.wounds ?? []).filter(
        (x) => x.kind === "cut" && x.zone.endsWith("_leg"),
      ),
    );
    return { life, w, sores, hash: JSON.stringify(sores.map((x) => [x.zone, x.severity, x.at])) };
  }

  it("con la opción abierta aparecen llagas en las piernas; sin ella, ninguna; es determinista", () => {
    const on = march(true);
    const off = march(false);
    expect(on.sores.length).toBeGreaterThan(off.sores.length);
    expect(on.w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: on.w.truth, log: on.w.log, ledger: on.w.ledger })).toEqual([]);
    expect(march(true).hash).toBe(on.hash);
  }, 600_000);
});

describe("el viajero gasta el calzado (opt-in)", () => {
  it("camina con el calzado nuevo y con el destrozado: el gastado tarda más y el nuevo se gasta", () => {
    const life = Life.create(7, content, {
      npcVerbs: ["move"],
      npcJourneyDays: 6,
      npcFootwear: true,
    });
    const w = life.world;
    const adults = living(w.truth).filter(
      (x) =>
        x !== life.player && (w.truth.get(PERSON, x)?.born ?? 0) < life.now - 20 * 365 * 86_400,
    );
    const [fresh, worn] = adults as [AgentId, AgentId];
    // Los dos salen del mismo hex lejano hacia el mismo lugar; uno con el calzado destrozado.
    const place = w.truth.ids(PLACE)[0] as string;
    const hexes = (w.truth.get(PLACE, place as never)?.hexes ?? []) as number[];
    let from = hexes[0] as number;
    for (let i = 0; i < 4; i++) {
      from =
        (w.map.neighbors[from] ?? []).find(
          (n) => !hexes.includes(n) && hexPath(w.map, n, hexes[0] as number).length > i,
        ) ?? from;
    }
    for (const who of [fresh, worn]) {
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
    w.truth.set(FOOTWEAR, worn, { wear: 1 });
    const t0 = life.now;
    life.advanceTo(t0 + 3 * 86_400);

    // El primer tramo de cada uno: el mismo camino, así que solo cambia lo que cuesta el calzado.
    const firstLeg = (who: AgentId) =>
      w.log.all().find((e) => e.kind === "action.move" && e.actors[0] === who && e.tick > t0);
    const legSeconds = (who: AgentId) =>
      (firstLeg(who)?.data as { seconds?: number } | undefined)?.seconds ?? 0;
    expect(legSeconds(fresh)).toBeGreaterThan(0);
    expect(legSeconds(worn)).toBeGreaterThan(legSeconds(fresh));
    // Caminar gastó el calzado nuevo; el destrozado sigue destrozado.
    expect(w.truth.get(FOOTWEAR, fresh)?.wear ?? 0).toBeGreaterThan(0);
    expect(w.truth.get(FOOTWEAR, worn)?.wear).toBe(1);
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  }, 300_000);
});
