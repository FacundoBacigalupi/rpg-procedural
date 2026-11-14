// El lobo que bajó ataca a quien encuentra solo afuera (novel3-beasts-fight-attack): con hambre y
// una sola persona al aire libre en su hex, se le tira encima para matarla, una vez por bajada; la
// pelea sale de ese ataque. Adentro no hay a quién ver.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, type EntityRef, loadContent } from "../../core/index.ts";
import { BEAST, checkInvariants, LOCATION, PLACE, SECT, WILDS } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { BEAST_ATTACK_EVENT, outdoorsAt } from "./beast-attack.ts";
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

describe("el lobo ataca (novel3-beasts-fight-attack)", () => {
  const content = loadContent(GAME_CONTENT_KINDS, sources("content"));

  const run = (inside: boolean) => {
    const life = Life.create(3, content, { cultivation: true, sectSeatRegion: true });
    const w = life.world;
    const me = life.player;
    const org = w.truth.ids(SECT)[0] as EntityRef;
    const seat = w.truth.get(SECT, org)?.seatPlace as EntityRef;
    const wilds = w.truth.get(WILDS, seat);
    if (!wilds) throw new Error("sin monte en la sede");
    w.truth.set(WILDS, seat, { ...wilds, populations: [{ lineage: "wolf", count: 200 }] });
    const hex = w.truth.get(PLACE, seat)?.hexes[0] as number;
    const room = w.spaces.spaces.find((s) => s.hex === hex && s.indoor);
    w.truth.set(LOCATION, me, inside && room ? { hex, space: room.key } : { hex });
    const company = outdoorsAt(w.truth, w.spaces, hex).filter((p) => p !== me);
    const from = life.now;
    life.advanceTo(life.now + 2 * DAY);
    const log = w.log.all().filter((e) => e.tick >= from);
    const attacks = log.filter((e) => e.kind === BEAST_ATTACK_EVENT);
    return { w, me, hex, room, company, log, attacks };
  };

  it("se le tira encima a quien está solo afuera y pelea para matarlo", () => {
    const { w, me, company, log, attacks } = run(false);
    expect(company).toEqual([]);
    const mine = attacks.filter((e) => e.actors[1] === me);
    expect(mine.length).toBe(1);
    const attack = mine[0];
    const beast = attack?.actors[0] as EntityRef;
    expect(w.truth.get(BEAST, beast)?.attacked).toBe(attack?.tick);
    const fight = log.find(
      (e) =>
        e.kind === "combat.fight" && e.causes.some((c) => "event" in c && c.event === attack?.id),
    );
    expect(fight?.actors).toEqual([beast, me]);
    expect(log.some((e) => e.kind.startsWith("law."))).toBe(false);
    expect(checkInvariants({ truth: w.truth, log: w.log })).toEqual([]);
  }, 600_000);

  it("adentro no lo ve", () => {
    const { me, room, attacks } = run(true);
    expect(room).toBeDefined();
    expect(attacks.filter((e) => e.actors[1] === me)).toEqual([]);
  }, 600_000);

  it("determinista", () => {
    const a = run(false);
    const b = run(false);
    expect(b.attacks.map((e) => [e.tick, e.actors, e.data])).toEqual(
      a.attacks.map((e) => [e.tick, e.actors, e.data]),
    );
  }, 600_000);
});
