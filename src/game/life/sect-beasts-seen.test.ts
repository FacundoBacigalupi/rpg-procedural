// La secta sabe del lobo por lo que vieron sus miembros (novel3-beasts-mission-seen): un miembro
// afuera en el hex del lobo lo anota para su secta (`BEAST_SEEN`, con un evento la primera vez); sin
// testigo de la secta, no sabe.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, type EntityRef, loadContent } from "../../core/index.ts";
import {
  BEAST,
  BEAST_SEEN,
  BEAST_SEEN_EVENT,
  checkInvariants,
  LOCATION,
  PLACE,
  SECT,
  SECT_MEMBER,
  WILDS,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}

const DAY = 86400;

describe("la secta sabe del lobo (novel3-beasts-mission-seen)", () => {
  const content = loadContent(GAME_CONTENT_KINDS, sources("content"));

  const run = (member: boolean) => {
    const life = Life.create(3, content, { cultivation: true, sectSeatRegion: true });
    const w = life.world;
    const me = life.player;
    const org = w.truth.ids(SECT)[0] as EntityRef;
    const seat = w.truth.get(SECT, org)?.seatPlace as EntityRef;
    const wilds = w.truth.get(WILDS, seat);
    if (!wilds) throw new Error("sin monte en la sede");
    w.truth.set(WILDS, seat, { ...wilds, populations: [{ lineage: "wolf", count: 200 }] });
    const hex = w.truth.get(PLACE, seat)?.hexes[0] as number;
    if (member) w.truth.set(SECT_MEMBER, me, { org, rank: "outer", since: life.now });
    else expect(w.truth.get(SECT_MEMBER, me)).toBeUndefined();
    w.truth.set(LOCATION, me, { hex });
    const from = life.now;
    life.advanceTo(life.now + DAY + 2 * 3600);
    const wolf = [...w.truth.ids(BEAST)][0] as EntityRef;
    const seen = w.log.all().filter((e) => e.tick >= from && e.kind === BEAST_SEEN_EVENT);
    return { w, me, org, hex, wolf, seen };
  };

  it("el miembro que lo ve afuera lo anota para su secta", () => {
    const { w, me, org, hex, wolf, seen } = run(true);
    const row = w.truth.get(BEAST_SEEN, wolf);
    expect(row).toMatchObject({ org, hex });
    const first = seen.filter((e) => (e.data as { beast: string }).beast === wolf);
    expect(first.length).toBe(1);
    expect(first[0]?.actors).toEqual([me]);
    expect(row?.cause).toBe(first[0]?.id);
    expect(checkInvariants({ truth: w.truth, log: w.log })).toEqual([]);
  }, 600_000);

  it("sin testigo de la secta no sabe", () => {
    const { w, wolf, seen } = run(false);
    expect(w.truth.get(BEAST_SEEN, wolf)).toBeUndefined();
    expect(seen).toEqual([]);
  }, 600_000);
});
