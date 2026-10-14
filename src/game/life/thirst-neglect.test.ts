// perfil2c-thirst-neglect: quien siente sed y tiene agua a mano bebe. Tres causas de muertes de sed
// en la corrida de perfil completo: el viajero encadenaba tramos sin beber, los chicos de pecho
// salían de recado solos y el personaje inactivo de la corrida sin jugador no seguía ni la rutina.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, loadContent } from "../../core/index.ts";
import {
  BODY_PLANS,
  BODY_STATE,
  CLEAN_WATER,
  checkInvariants,
  hexPath,
  LOCATION,
  newBody,
  PERSON,
  PLACE,
  THIRSTY_FRACTION,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { NPC_DECISION } from "./decide.ts";
import { Life } from "./life.ts";
import { drinkOnRoad } from "./npc-verbs.ts";
import { PLAYER } from "./player.ts";
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
const human = content.get(BODY_PLANS, "human");
if (!human) throw new Error("sin plan humano");

describe("drinkOnRoad: el sorbo del viajero", () => {
  const thirsty = { ...newBody(human, 60, 0), water: 3 };
  it("sin sed no bebe", () => {
    const fine = { ...newBody(human, 60, 0), water: THIRSTY_FRACTION * 60 };
    expect(drinkOnRoad(human, fine, 2, 2)).toBeUndefined();
  });
  it("con sed bebe de la fuente (hasta 1,5 L) y vuelve a llenar el odre", () => {
    const sip = drinkOnRoad(human, thirsty, 0.5, 2, CLEAN_WATER);
    expect(sip?.from).toBe("source");
    expect(sip?.liters).toBeCloseTo(1.5, 5);
    expect(sip?.body.water).toBeCloseTo(1.5, 5);
    expect(sip?.skin).toBe(2);
  });
  it("si el agua del hex no hidrata (mar) bebe del odre y lo gasta", () => {
    const sea = { ...CLEAN_WATER, salinity: 1 };
    const sip = drinkOnRoad(human, thirsty, 1, 2, sea);
    expect(sip?.from).toBe("skin");
    expect(sip?.liters).toBe(1);
    expect(sip?.skin).toBe(0);
    expect(sip?.body.water).toBeCloseTo(2, 5);
  });
  it("sin fuente que hidrate ni odre, no hay con qué", () => {
    expect(drinkOnRoad(human, thirsty, 0, 2, { ...CLEAN_WATER, salinity: 1 })).toBeUndefined();
  });
});

describe("el viajero con sed bebe en el camino (opt-in npcWater)", () => {
  it("un NPC en viaje con 3 L de déficit bebe y deja el evento con su causa", () => {
    const life = Life.create(7, content, {
      npcVerbs: ["move"],
      npcJourneyDays: 6,
      npcWater: { liters: 2 },
    });
    const w = life.world;
    const npc = living(w.truth).find(
      (x) => x !== life.player && (w.truth.get(PERSON, x)?.born ?? 0) < life.now - 20 * 365 * DAY,
    ) as AgentId;
    const place = w.truth.ids(PLACE)[0] as string;
    const hexes = (w.truth.get(PLACE, place as never)?.hexes ?? []) as number[];
    let from = hexes[0] as number;
    for (let i = 0; i < 4; i++) {
      from =
        (w.map.neighbors[from] ?? []).find(
          (n) => !hexes.includes(n) && hexPath(w.map, n, hexes[0] as number).length > i,
        ) ?? from;
    }
    w.truth.set(LOCATION, npc, { hex: from });
    const body = w.truth.get(BODY_STATE, npc);
    w.truth.set(BODY_STATE, npc, { ...(body as object), water: 3 } as never);
    w.truth.set(NPC_DECISION, npc, {
      at: life.now,
      id: `move:${place}+toward:agent:99`,
      verb: "move",
      target: place,
      utility: 1,
      options: 2,
    } as never);
    life.advanceTo(life.now + 6 * 3600);
    const drank = w.log.all().filter((e) => e.kind === "npc.drank" && e.actors[0] === npc);
    expect(drank.length).toBeGreaterThan(0);
    expect(drank[0]?.causes).toEqual([{ kind: "state", entity: npc, key: "body.water" }]);
    const after = w.truth.get(BODY_STATE, npc);
    expect(after?.water ?? 99).toBeLessThan(2);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  }, 240_000);
});

describe("recados: los chicos no salen solos (minAgeYears)", () => {
  it("con edad mínima 12 y chance 1 ningún menor decide ir a otro lugar", () => {
    const life = Life.create(7, content, {
      npcVerbs: ["move"],
      npcJourneyDays: 6,
      errands: { kinds: ["fields", "forest", "water"], chance: 1, weight: 5, minAgeYears: 12 },
    });
    const w = life.world;
    const seen = { kidsMove: 0, adultsMove: 0 };
    for (let d = 0; d < 3; d++) {
      life.advanceTo(life.now + DAY);
      for (const id of living(w.truth)) {
        if (id === life.player) continue;
        const dec = w.truth.get(NPC_DECISION, id);
        if (dec?.verb !== "move" || !dec.id.startsWith("move:place:")) continue;
        const age = (life.now - (w.truth.get(PERSON, id)?.born ?? 0)) / w.clock.year;
        if (age < 12) seen.kidsMove++;
        else seen.adultsMove++;
      }
    }
    expect(seen.kidsMove).toBe(0);
    expect(seen.adultsMove).toBeGreaterThan(0);
  }, 240_000);
});

describe("el personaje inactivo sigue la rutina (opt-in idlePlayerRoutine)", () => {
  it("sin nadie que juegue no muere de sed a los tres días", () => {
    const life = Life.create(1, content, { idlePlayerRoutine: true });
    const w = life.world;
    expect(w.truth.has(PLAYER, life.player)).toBe(true);
    life.advanceTo(life.now + 5 * DAY);
    const body = w.truth.get(BODY_STATE, life.player);
    expect(body?.death).toBeNull();
    expect(body?.consciousness).not.toBe("unconscious");
    expect((body?.water ?? 99) / (body?.massKg ?? 1)).toBeLessThan(0.08);
  }, 240_000);
});
