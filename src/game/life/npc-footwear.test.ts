import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, loadContent } from "../../core/index.ts";
import { checkInvariants, hexPath, LOCATION, PERSON, PLACE } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { optInParts } from "./create.ts";
import { NPC_DECISION } from "./decide.ts";
import {
  FOOTWEAR,
  FOOTWEAR_LIFE_SECONDS,
  footwearWalkFactor,
  ROUGH_WEAR,
  WORN_EXTRA,
  wearAfter,
} from "./footwear.ts";
import { Life } from "./life.ts";
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
