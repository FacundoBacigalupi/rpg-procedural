import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  externalAccount,
  loadContent,
} from "../../core/index.ts";
import { COPPER, checkInvariants, LOCATION, PERSON, PLACE, WAGES_SINK } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { NPC_DECISION } from "./decide.ts";
import { NPC_JOURNEY } from "./npc-verbs.ts";
import { FOOTWEAR } from "./footwear.ts";
import {
  FOOTWEAR_ROAD_MENDED,
  ROAD_KEEPS,
  ROAD_MARKUP,
  atStop,
  roadMendJob,
} from "./footwear-road-mend.ts";
import { Life } from "./life.ts";
import { validateLifeDependencies } from "./profile.ts";
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

describe("arreglar el calzado de camino (npc-b2b3b2b3c, opt-in)", () => {
  it("el arreglo de camino es puro: nada si no hace falta, y sale mÃ¡s caro", () => {
    expect(roadMendJob(0.2)).toBeNull();
    expect(roadMendJob(0.8)).toEqual({ kind: "mend", cost: 2 * ROAD_MARKUP });
    expect(roadMendJob(0.95)).toEqual({ kind: "replace", cost: 8 * ROAD_MARKUP });
    expect(
      validateLifeDependencies({ npcRoadMend: true }).some((i) => i.requires === "npcFootwearMend"),
    ).toBe(true);
  });

  function run(on: boolean, onRoad: boolean) {
    const life = Life.create(7, content, {
      npcVerbs: ["move"],
      npcJourneyDays: 6,
      npcFootwear: true,
      npcFootwearMend: true,
      ...(on ? { npcRoadMend: true } : {}),
    });
    const w = life.world;
    const adults = living(w.truth).filter(
      (x) =>
        x !== life.player && (w.truth.get(PERSON, x)?.born ?? 0) < life.now - 20 * 365 * 86_400,
    ) as AgentId[];
    const place = w.truth.ids(PLACE)[0] as string;
    const hexes = (w.truth.get(PLACE, place as never)?.hexes ?? []) as number[];
    let from = hexes[0] as number;
    for (let i = 0; i < 4; i++) {
      from = (w.map.neighbors[from] ?? []).find((n) => !hexes.includes(n)) ?? from;
    }
    for (const who of adults.slice(0, 6)) {
      if (onRoad) {
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
      w.truth.set(FOOTWEAR, who, { wear: 0.8 });
    }
    life.advanceTo(life.now + 6 * 86_400);
    return { life, w };
  }

  it("de camino paga doble al sumidero y el remiendo deja mÃ¡s desgaste", () => {
    const r = run(true, true);
    const mended = r.w.log.all().filter((e) => e.kind === FOOTWEAR_ROAD_MENDED);
    expect(mended.length).toBeGreaterThan(0);
    const paid = mended.reduce((n, e) => n + (e.data as { paid: number }).paid, 0);
    expect(paid).toBeGreaterThan(0);
    expect(r.w.ledger.balance(externalAccount(WAGES_SINK), COPPER)).toBe(paid);
    const first = mended[0]?.data as { from: number; to: number; job: string };
    if (first.job === "mend") expect(first.to).toBeCloseTo(first.from * ROAD_KEEPS, 5);
    expect(r.w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: r.w.truth, log: r.w.log, ledger: r.w.ledger })).toEqual([]);
  }, 300_000);

  it("sin la opciÃ³n, o en la aldea, nadie arregla de camino", () => {
    expect(
      run(false, true)
        .w.log.all()
        .some((e) => e.kind === FOOTWEAR_ROAD_MENDED),
    ).toBe(false);
    expect(
      run(true, false)
        .w.log.all()
        .some((e) => e.kind === FOOTWEAR_ROAD_MENDED),
    ).toBe(false);
  }, 300_000);

  it("es determinista", () => {
    const key = (r: ReturnType<typeof run>) =>
      JSON.stringify(
        r.w.log
          .all()
          .filter((e) => e.kind === FOOTWEAR_ROAD_MENDED)
          .map((e) => [e.id, e.data]),
      );
    expect(key(run(true, true))).toBe(key(run(true, true)));
  }, 300_000);

  it("las paradas reales: solo cuenta la noche que paró a dormir", () => {
    expect(atStop(undefined, 1000)).toBe(false);
    expect(atStop(1000, 1000 + 3600)).toBe(true);
    expect(atStop(1000, 1000 + 86_400)).toBe(false);
    const issues = validateLifeDependencies({ npcRoadStops: true });
    expect(issues.some((i) => i.requires === "npcRoadMend")).toBe(true);
    expect(issues.some((i) => i.requires === "npcNightRest")).toBe(true);
  });

  function runStops(stops: boolean, rested: boolean) {
    const life = Life.create(7, content, {
      npcVerbs: ["move"],
      npcJourneyDays: 6,
      npcFootwear: true,
      npcFootwearMend: true,
      npcRoadMend: true,
      ...(stops ? { npcRoadStops: true } : {}),
    });
    const w = life.world;
    const adults = living(w.truth).filter(
      (x) =>
        x !== life.player && (w.truth.get(PERSON, x)?.born ?? 0) < life.now - 20 * 365 * 86_400,
    ) as AgentId[];
    const place = w.truth.ids(PLACE)[0] as string;
    const hexes = (w.truth.get(PLACE, place as never)?.hexes ?? []) as number[];
    let from = hexes[0] as number;
    for (let i = 0; i < 4; i++) {
      from = (w.map.neighbors[from] ?? []).find((n) => !hexes.includes(n)) ?? from;
    }
    for (const who of adults.slice(0, 6)) {
      w.truth.set(LOCATION, who, { hex: from });
      w.truth.set(NPC_JOURNEY, who, {
        place,
        since: life.now,
        decision: "x",
        ...(rested ? { rested: life.now } : {}),
      } as never);
      w.truth.set(FOOTWEAR, who, { wear: 0.8 });
    }
    life.advanceTo(life.now + 86_400);
    return w.log.all().filter((e) => e.kind === FOOTWEAR_ROAD_MENDED).length;
  }

  it("con paradas, sin dormir en el camino no se arregla; sin la opción, sí", () => {
    expect(runStops(true, false)).toBe(0);
    expect(runStops(true, true)).toBeLessThanOrEqual(runStops(false, true));
    expect(runStops(true, true)).toBe(runStops(true, true));
  }, 300_000);
});
