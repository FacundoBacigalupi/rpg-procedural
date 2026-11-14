// La armería de la secta (novel3-weapons-sect): la sede llega con el arma de su escuela, los internos
// y el maestro la traen en la mano y quedan unas de repuesto en el salón, de la secta; el que es de
// la secta canjea puntos por una, si queda de la forma que pide y le alcanzan.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  type EntityRef,
  type HolderRef,
  loadContent,
} from "../../core/index.ts";
import {
  type ActionPlan,
  BODY_STATE,
  checkInvariants,
  ITEM_HOLD,
  ITEM_LOOK,
  LOCATION,
  PLACE,
  SECT,
  SECT_CONTRIBUTION,
  SECT_EXCHANGE_EVENT,
  SECT_MEMBER,
  sectSpaceKey,
  sectWeapons,
  WEAPONS,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";
import { ARMORY_SPARES, SECT_HALL, SECT_HALL_EVENT, schoolWeapon } from "./sect-hall.ts";
import { playerView } from "./view.ts";

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}

const ask = (actor: AgentId, text: string): ActionPlan => ({
  actor,
  source: "player",
  root: { kind: "do", verb: "redeem", args: [{ role: "what", text }], manner: [] },
  manner: [],
  causes: [{ kind: "state", entity: actor, key: "intent" }],
});

const HOUR = 3600;
const WORD: Record<string, string> = {
  sword: "espada",
  saber: "sable",
  spear: "lanza",
  stick: "palo",
};

describe("la armería de la secta (novel3-weapons-sect)", () => {
  const content = loadContent(GAME_CONTENT_KINDS, sources("content"));

  it("el arma de la escuela es fija por seed y secta, y sale de las que se canjean", () => {
    const armory = sectWeapons(content.all(WEAPONS));
    expect(armory.length).toBeGreaterThan(0);
    expect(armory.every((w) => w.points !== undefined && w.wound !== "blunt")).toBe(true);
    const org = "org:1" as EntityRef;
    expect(schoolWeapon(armory, 5, org)).toEqual(schoolWeapon([...armory].reverse(), 5, org));
    expect(armory).toContainEqual(schoolWeapon(armory, 5, org));
    expect(schoolWeapon([], 5, org)).toBeUndefined();
  });

  it("la sede llega armada y canjea un arma de repuesto por puntos", () => {
    const life = Life.create(3, content, { cultivation: true, sectSeatRegion: true });
    const w = life.world;
    const me = life.player;
    const ref = me as unknown as EntityRef;
    const org = w.truth.ids(SECT)[0] as EntityRef;
    const sect = w.truth.get(SECT, org);
    if (!sect) throw new Error("sin secta");
    const hex = w.truth.get(PLACE, sect.seatPlace)?.hexes[0] as number;
    const hall = sectSpaceKey(sect.seatPlace, "hall");
    w.truth.set(LOCATION, me, { hex });
    life.advanceTo(life.now + 2 * HOUR);

    // La sede en carne: el evento dice qué arma usa la escuela.
    const born = w.log.all().find((e) => e.kind === SECT_HALL_EVENT);
    const shape = (born?.data as { weapon?: string } | undefined)?.weapon;
    expect(shape).toBeDefined();
    const carried = (holder: EntityRef) =>
      [...w.truth.ids(ITEM_HOLD)].filter(
        (i) =>
          w.truth.get(ITEM_HOLD, i)?.possession === (holder as unknown as HolderRef) &&
          w.truth.get(ITEM_LOOK, i)?.shape === shape,
      );
    for (const x of w.truth.get(SECT_HALL, org)?.people ?? []) {
      const p = x.person as unknown as EntityRef;
      const n = carried(p).length;
      expect(n).toBe(w.truth.get(SECT_MEMBER, p)?.rank === "outer" ? 0 : 1);
    }
    const spares = carried(org);
    expect(spares.length).toBe(ARMORY_SPARES);
    for (const s of spares) expect(w.truth.get(LOCATION, s)?.space).toBe(hall);

    const rested = () => {
      const body = w.truth.get(BODY_STATE, me);
      if (body) w.truth.set(BODY_STATE, me, { ...body, sleepDebt: 0, fatigue: 0, water: 0 });
      w.truth.set(LOCATION, me, { hex, space: hall });
    };
    const exchange = (from: number) =>
      w.log
        .all()
        .find((e) => e.kind === SECT_EXCHANGE_EVENT && e.actors[0] === me && e.tick >= from);
    w.truth.set(SECT_MEMBER, me, { org, rank: "outer", since: life.now });
    const word = WORD[shape as string] ?? "arma";
    const other = Object.entries(WORD).find(([s]) => s !== shape)?.[1] as string;

    // Sin puntos: no.
    w.truth.set(SECT_CONTRIBUTION, me, { org, points: 5, hours: 1, last: life.now });
    rested();
    let from = life.now;
    life.turn(ask(me, word), 1);
    expect(exchange(from)?.data).toMatchObject({ what: "weapon", refused: "no_points" });
    expect(playerView(w, [], { heardSince: from }).self.cues).toContain("weapon_no_points");

    // Otra forma que la de la escuela: no hay.
    w.truth.set(SECT_CONTRIBUTION, me, { org, points: 100, hours: 1, last: life.now });
    rested();
    from = life.now;
    life.turn(ask(me, other), 1);
    expect(exchange(from)?.data).toMatchObject({ what: "weapon", refused: "no_stock" });
    expect(playerView(w, [], { heardSince: from }).self.cues).toContain("weapon_no_stock");
    expect(w.truth.get(SECT_CONTRIBUTION, ref)?.points).toBe(100);

    // La de la escuela, con puntos: pasa de la secta a su mano y deja el salón.
    rested();
    from = life.now;
    life.turn(ask(me, word), 1);
    const got = exchange(from)?.data as { item?: string; shape?: string; points?: number };
    expect(got).toMatchObject({ what: "weapon", shape });
    const item = got.item as unknown as EntityRef;
    expect(w.truth.get(ITEM_HOLD, item)?.possession).toBe(me as unknown as HolderRef);
    expect(w.truth.get(LOCATION, item)).toBeUndefined();
    expect(w.truth.get(SECT_CONTRIBUTION, ref)?.points).toBe(100 - (got.points ?? 0));
    expect(carried(org).length).toBe(ARMORY_SPARES - 1);
    expect(playerView(w, [], { heardSince: from }).self.cues).toContain("weapon_bought");
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log })).toEqual([]);
  }, 600_000);
});
