import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, loadContent, Rng } from "../../core/index.ts";
import { BODY_STATE, checkInvariants, hexPath, LOCATION, PERSON, PLACE } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { optInParts } from "./create.ts";
import { NPC_DECISION } from "./decide.ts";
import { engineOptions, Life } from "./life.ts";
import { FULL_PROFILE } from "./profile.ts";
import { STRAIN_AT, STRAIN_FORCE, STRAIN_PER_HOUR, strainBlow, strainChance } from "./strain.ts";
import { living } from "./world.ts";

describe("esguinces por forzar el paso (puro)", () => {
  it("sin paso forzado, sin cansancio suficiente o sin marcha no hay chance", () => {
    expect(strainChance(1, 3600, false)).toBe(0);
    expect(strainChance(STRAIN_AT, 3600, true)).toBe(0);
    expect(strainChance(0.2, 3600, true)).toBe(0);
    expect(strainChance(1, 0, true)).toBe(0);
    expect(strainChance(1, Number.NaN, true)).toBe(0);
  });
  it("crece con la fatiga y las horas, y no pasa de 1", () => {
    expect(strainChance(1, 3600, true)).toBe(STRAIN_PER_HOUR);
    expect(strainChance(0.8, 3600, true)).toBeCloseTo(STRAIN_PER_HOUR / 2, 6);
    expect(strainChance(1, 10_000 * 3600, true)).toBe(1);
  });
  it("el esguince es una contusión leve de pierna con causa; sin chance no hay golpe", () => {
    const rng = Rng.root(5);
    expect(strainBlow(1, 3600, false, rng.fork("a"), "e:1" as never, 0)).toBeNull();
    const blow = strainBlow(1, 10_000 * 3600, true, rng.fork("b"), "e:1" as never, 9);
    expect(blow?.kind).toBe("blunt");
    expect(["left_leg", "right_leg"]).toContain(blow?.zone);
    expect(blow?.force).toBeLessThan(STRAIN_FORCE * 1.5 + 1e-9);
    expect(blow?.cause).toBe("e:1");
    expect(blow?.at).toBe(9);
  });
  it("apagado por defecto; el perfil completo lo enciende desde life-17", () => {
    expect(optInParts({})).toEqual({});
    expect(optInParts({ npcStrain: true })).toEqual({ npcStrain: true });
    expect(optInParts({ npcStrain: true, legacyNoStrain: true })).toEqual({});
    expect(FULL_PROFILE.npcStrain).toBe(true);
    expect(engineOptions("life-16", FULL_PROFILE).legacyNoStrain).toBe(true);
    expect(engineOptions("life-17", FULL_PROFILE).legacyNoStrain).toBeUndefined();
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

describe("el viajero cansado que fuerza el paso se tuerce una pierna (opt-in)", () => {
  function march(strain: boolean, pace: "fast" | "careful") {
    const life = Life.create(7, content, {
      npcVerbs: ["move"],
      npcJourneyDays: 6,
      npcPace: pace,
      ...(strain ? { npcStrain: true } : {}),
    });
    const w = life.world;
    const walkers = living(w.truth)
      .filter(
        (x) =>
          x !== life.player && (w.truth.get(PERSON, x)?.born ?? 0) < life.now - 20 * 365 * 86_400,
      )
      .slice(0, 8) as AgentId[];
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
    }
    // Cansados (sin pasar de TIRED_STOP, que los haría parar): se repone la fatiga cada hora.
    for (let h = 0; h < 48; h++) {
      for (const who of walkers) {
        const b = w.truth.get(BODY_STATE, who);
        if (b && b.fatigue < 0.8) w.truth.set(BODY_STATE, who, { ...b, fatigue: 0.8 });
      }
      life.advanceTo(life.now + 3600);
    }
    const sprains = walkers.flatMap((who) =>
      (w.truth.get(BODY_STATE, who)?.wounds ?? []).filter(
        (x) => x.kind === "blunt" && x.zone.endsWith("_leg"),
      ),
    );
    return { w, sprains, hash: JSON.stringify(sprains.map((x) => [x.zone, x.severity, x.at])) };
  }

  it("a paso fast aparecen esguinces; sin la opción o a paso careful, ninguno; determinista", () => {
    const on = march(true, "fast");
    const off = march(false, "fast");
    const slow = march(true, "careful");
    expect(on.sprains.length).toBeGreaterThan(off.sprains.length);
    expect(on.sprains.length).toBeGreaterThan(slow.sprains.length);
    expect(on.w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: on.w.truth, log: on.w.log, ledger: on.w.ledger })).toEqual([]);
    expect(march(true, "fast").hash).toBe(on.hash);
  }, 900_000);
});
