// La sede sin el personaje (novel-sect-seat-return-sleepers): con `sleepers`, cuando el personaje
// baja a la aldea la gente de la sede queda lejos y se duerme (tier 1); al volver se despierta puesta
// al día: comió de la despensa de la sede por el libro mayor, no cosechó campos y sigue en la sede.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  type EntityRef,
  HOUR,
  loadContent,
} from "../../core/index.ts";
import {
  ASLEEP,
  BODY_STATE,
  checkInvariants,
  ENTITY,
  LOCATION,
  PLACE,
  SECT,
  SECT_MEMBER,
  sectSpaceKey,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";
import { SECT_HALL } from "./sect-hall.ts";
import { CAUGHT_UP_EVENT, NPC_HARVESTED_EVENT } from "./sleepers.ts";

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}

describe("la sede mientras el personaje no está", () => {
  it("con sleepers, la gente de la sede se duerme y se despierta al día", () => {
    const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
    const life = Life.create(3, content, {
      cultivation: true,
      sectSeatRegion: true,
      sleepers: { near: 0, food: "grain" },
    });
    const w = life.world;
    const me = life.player;
    const village = w.truth.get(LOCATION, me)?.hex as number;
    const org = w.truth.ids(SECT)[0] as EntityRef;
    const sect = w.truth.get(SECT, org);
    if (!sect) throw new Error("sin secta");
    const seat = w.truth.get(PLACE, sect.seatPlace)?.hexes[0] as number;
    const hall = { hex: seat, space: sectSpaceKey(sect.seatPlace, "hall") };
    const rested = () => {
      const body = w.truth.get(BODY_STATE, me);
      if (body) w.truth.set(BODY_STATE, me, { ...body, sleepDebt: 0, fatigue: 0, water: 0 });
    };
    w.truth.set(SECT_MEMBER, me, { org, rank: "inner", since: life.now });
    w.truth.set(LOCATION, me, hall);
    life.advanceTo(life.now + 3 * HOUR);
    const people = (w.truth.get(SECT_HALL, org)?.people ?? []).map((p) => p.person as AgentId);
    expect(people.length).toBeGreaterThan(0);
    const alive = () =>
      people.filter((p) => w.truth.get(ENTITY, p as unknown as EntityRef)?.endedAt === undefined);
    const born = alive().length;

    // Baja a la aldea: la sede queda lejos y su gente se duerme.
    w.truth.set(LOCATION, me, { hex: village });
    rested();
    life.advanceTo(life.now + 2 * HOUR);
    for (const p of alive()) expect(w.truth.has(ASLEEP, p)).toBe(true);
    for (let d = 0; d < 3; d++) {
      rested();
      life.advanceTo(life.now + w.clock.day);
    }
    // Vuelve: se despiertan puestos al día, en la sede y vivos.
    const back = life.now;
    w.truth.set(LOCATION, me, hall);
    rested();
    life.advanceTo(life.now + 3 * HOUR);
    expect(alive().length).toBe(born);
    for (const p of alive()) {
      expect(w.truth.has(ASLEEP, p)).toBe(false);
      expect(w.truth.get(LOCATION, p)?.space?.startsWith(`sect:${sect.seatPlace}/`)).toBe(true);
      const body = w.truth.get(BODY_STATE, p);
      expect(body?.updatedAt).toBeGreaterThanOrEqual(back);
    }
    const caught = w.log
      .all()
      .filter((e) => e.kind === CAUGHT_UP_EVENT && people.includes(e.actors[0] as AgentId));
    expect(caught.length).toBeGreaterThan(0);
    // Dormidos no cosechan: no trabajan campos (meditan o hacen tareas).
    const harvested = w.log
      .all()
      .filter((e) => e.kind === NPC_HARVESTED_EVENT && people.includes(e.actors[0] as AgentId));
    expect(harvested).toEqual([]);
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log })).toEqual([]);
  }, 590_000);
});
