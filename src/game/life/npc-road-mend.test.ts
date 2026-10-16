import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  externalAccount,
  type HolderRef,
  holderAccount,
  loadContent,
} from "../../core/index.ts";
import { COPPER, checkInvariants, LOCATION, PERSON, PLACE, WAGES_SINK } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { COBBLER, HIDES_SOURCE, LEATHER_SCRAP, LEATHER_UNIT, mendKeeps } from "./cobbler.ts";
import { NPC_DECISION } from "./decide.ts";
import { FOOTWEAR } from "./footwear.ts";
import {
  atStop,
  cobblerHere,
  FOOTWEAR_ROAD_MENDED,
  ROAD_KEEPS,
  ROAD_MARKUP,
  roadMendJob,
} from "./footwear-road-mend.ts";
import { Life } from "./life.ts";
import { NPC_JOURNEY } from "./npc-verbs.ts";
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
  it("el arreglo de camino es puro: nada si no hace falta, y sale más caro", () => {
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

  it("de camino paga doble al sumidero y el remiendo deja más desgaste", () => {
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

  it("sin la opción, o en la aldea, nadie arregla de camino", () => {
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
    for (const who of adults.slice(0, 12)) {
      w.truth.set(LOCATION, who, { hex: from });
      w.truth.set(NPC_JOURNEY, who, {
        place,
        since: life.now,
        decision: "x",
        ...(rested ? { rested: life.now + 43_200 } : {}),
      } as never);
      w.truth.set(FOOTWEAR, who, { wear: 0.8 });
    }
    life.advanceTo(life.now + 86_400);
    return w.log.all().filter((e) => e.kind === FOOTWEAR_ROAD_MENDED).length;
  }

  it("con paradas, sin dormir en el camino no se arregla; durmiendo, sí", () => {
    expect(runStops(true, false)).toBe(0);
    const stopped = runStops(true, true);
    expect(stopped).toBeGreaterThan(0);
    expect(stopped).toBeLessThanOrEqual(runStops(false, true));
    expect(runStops(true, true)).toBe(stopped);
  }, 300_000);

  function runCobbler(cobbler: boolean, together: boolean) {
    const life = Life.create(7, content, {
      npcVerbs: ["move"],
      npcJourneyDays: 6,
      npcFootwear: true,
      npcFootwearMend: true,
      npcCobbler: true,
      npcRoadMend: true,
      ...(cobbler ? { npcRoadCobbler: true } : {}),
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
    const shoemaker = adults[12] as AgentId;
    w.truth.set(COBBLER, shoemaker, { level: 0.9 });
    w.truth.set(LOCATION, shoemaker, {
      hex: together ? from : (hexes[0] as number),
      ...(together ? {} : (w.truth.get(LOCATION, shoemaker) ?? {})),
    } as never);
    // El zapatero también está de viaje (si no, la rutina lo manda a casa).
    w.truth.set(NPC_JOURNEY, shoemaker, { place, since: life.now, decision: "x" } as never);
    const bag = holderAccount(shoemaker as unknown as HolderRef);
    const first = w.log.all()[0];
    if (!first) throw new Error("sin eventos");
    w.ledger.post({
      tick: first.tick,
      eventId: first.id,
      transfers: [
        { unit: LEATHER_UNIT, from: externalAccount(HIDES_SOURCE), to: bag, amount: 5000 },
      ],
    });
    for (const who of adults.slice(0, 6)) {
      w.truth.set(LOCATION, who, { hex: from });
      w.truth.set(NPC_JOURNEY, who, {
        place,
        since: life.now,
        decision: "x",
      } as never);
      w.truth.set(FOOTWEAR, who, { wear: 0.8 });
    }
    // Caminan a ritmos distintos: justo antes de cerrar el día el zapatero se pone donde está uno de ellos.
    const start = life.now;
    life.advanceTo(start + 86_400 - 60);
    const mate = w.truth.get(LOCATION, adults[0] as AgentId);
    if (together && mate) w.truth.set(LOCATION, shoemaker, { hex: mate.hex });
    life.advanceTo(start + 86_400 + 60);
    return { life, w, shoemaker };
  }

  it("el zapatero que está en el mismo lugar arregla con su oficio y su cuero", () => {
    expect(cobblerHere({ hex: 3 }, { hex: 3, inVillage: false, leather: 200 }, "mend")).toBe(true);
    expect(cobblerHere({ hex: 3 }, { hex: 4, inVillage: false, leather: 900 }, "mend")).toBe(false);
    expect(cobblerHere({ hex: 3 }, { hex: 3, inVillage: true, leather: 900 }, "mend")).toBe(false);
    expect(cobblerHere({ hex: 3 }, { hex: 3, inVillage: false, leather: 100 }, "mend")).toBe(false);
    expect(validateLifeDependencies({ npcRoadCobbler: true }).map((i) => i.requires)).toEqual(
      expect.arrayContaining(["npcRoadMend", "npcCobbler"]),
    );
    const r = runCobbler(true, true);
    const mended = r.w.log
      .all()
      .filter((e) => e.kind === FOOTWEAR_ROAD_MENDED && (e.data as { cobbler?: string }).cobbler);
    expect(mended.length).toBeGreaterThan(0);
    const d = mended[0]?.data as { from: number; to: number; job: string; cobbler: string };
    expect(d.cobbler).toBe(r.shoemaker);
    if (d.job === "mend") expect(d.to).toBeCloseTo(d.from * mendKeeps(0.9), 1);
    // El cobre lo cobra el zapatero (no el sumidero) y el cuero sale a retazos.
    const paid = mended.reduce((n, e) => n + (e.data as { paid: number }).paid, 0);
    expect(r.w.ledger.balance(externalAccount(WAGES_SINK), COPPER)).toBe(0);
    expect(paid).toBeGreaterThan(0);
    expect(r.w.ledger.balance(externalAccount(LEATHER_SCRAP), LEATHER_UNIT)).toBeGreaterThan(0);
    expect(r.w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: r.w.truth, log: r.w.log, ledger: r.w.ledger })).toEqual([]);
  }, 300_000);

  it("sin la opción, o con el zapatero en otro lugar, arregla el remendón de fuera", () => {
    const coop = (r: ReturnType<typeof runCobbler>) =>
      r.w.log
        .all()
        .filter((e) => e.kind === FOOTWEAR_ROAD_MENDED && (e.data as { cobbler?: string }).cobbler);
    expect(coop(runCobbler(false, true)).length).toBe(0);
    expect(coop(runCobbler(true, false)).length).toBe(0);
    const k = (r: ReturnType<typeof runCobbler>) =>
      JSON.stringify(coop(r).map((e) => [e.id, e.data]));
    expect(k(runCobbler(true, true))).toBe(k(runCobbler(true, true)));
  }, 300_000);
});
