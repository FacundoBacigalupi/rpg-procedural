// La vuelta a la aldea (novel-sect-seat-return-trek): de la sede, un `move` a la aldea es la marcha
// inversa entre parches y llega vivo; ya en la aldea, la rutina delegada no lo devuelve a la cueva de
// la sede: la casa y el trabajo de la sede valen solo en su parche.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, type EntityRef, HOUR, loadContent } from "../../core/index.ts";
import {
  type ActionPlan,
  BODY_STATE,
  checkInvariants,
  LOCATION,
  PLACE,
  patchOf,
  SECT,
  SECT_MEMBER,
  sectSpaceKey,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";
import { ROUTINE_MEDITATE_EVENT } from "./meditate.ts";
import { seatRoutineOf } from "./sect-hall.ts";
import { PLAYER_TREK } from "./trek.ts";
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

describe("volver de la sede a la aldea", () => {
  it("el interno baja caminando, llega vivo y en la aldea vive como cualquiera", () => {
    const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
    const life = Life.create(3, content, {
      cultivation: true,
      sectSeatRegion: true,
      playerTrek: true,
    });
    const w = life.world;
    const me = life.player;
    const home = w.truth.get(LOCATION, me)?.hex as number;
    const village = w.truth
      .ids(PLACE)
      .find(
        (p) =>
          w.truth.get(PLACE, p)?.kind === "village" && w.truth.get(PLACE, p)?.hexes.includes(home),
      ) as EntityRef;
    expect(village).toBeDefined();
    const villageHexes = w.truth.get(PLACE, village)?.hexes ?? [];
    const org = w.truth.ids(SECT)[0] as EntityRef;
    const sect = w.truth.get(SECT, org);
    if (!sect) throw new Error("sin secta");
    const seat = w.truth.get(PLACE, sect.seatPlace)?.hexes[0] as number;
    w.truth.set(SECT_MEMBER, me, { org, rank: "inner", since: life.now });
    w.truth.set(LOCATION, me, { hex: seat, space: sectSpaceKey(sect.seatPlace, "dorm") });
    life.advanceTo(life.now + HOUR);
    // En la sede, la rutina del interno es la de la sede.
    expect(seatRoutineOf(w.truth, me, w.map)?.work).toBe(sectSpaceKey(sect.seatPlace, "cave"));

    const plan: ActionPlan = {
      actor: me,
      source: "player",
      root: { kind: "do", verb: "move", args: [{ role: "to", entity: village }], manner: [] },
      manner: [],
      causes: [{ kind: "state", entity: me, key: "intent" }],
    };
    const from = life.now;
    let turns = 0;
    const at = () => w.truth.get(LOCATION, me)?.hex as number;
    while (life.alive && !villageHexes.includes(at()) && turns < 20) life.turn(plan, ++turns);
    const trek = w.log.all().filter((e) => e.kind === "life.trek" && e.actors.includes(me));
    expect(life.alive).toBe(true);
    expect(villageHexes).toContain(at());
    expect(trek[0]?.data).toMatchObject({ what: "started" });
    expect(trek.at(-1)?.data).toMatchObject({ what: "arrived" });
    expect((life.now - from) / w.clock.day).toBeGreaterThan(1);
    expect(w.truth.has(PLAYER_TREK, me)).toBe(false);
    const last = trek.at(-1)?.tick ?? life.now;
    expect(playerView(w, [], { heardSince: last }).self.cues).toContain("trek_arrived");

    // En la aldea, la sede no es su casa ni su trabajo: un día delegado no lo lleva a la cueva.
    expect(seatRoutineOf(w.truth, me, w.map)).toBeUndefined();
    const body = w.truth.get(BODY_STATE, me);
    if (body) w.truth.set(BODY_STATE, me, { ...body, sleepDebt: 0, fatigue: 0, water: 0 });
    const since = life.now;
    const day: ActionPlan = {
      actor: me,
      source: "routine",
      root: { kind: "do", verb: "wait", args: [{ role: "for", seconds: 24 * HOUR }], manner: [] },
      manner: [],
      causes: [{ kind: "state", entity: me, key: "intent" }],
    };
    life.turn(day, ++turns);
    const sat = w.log
      .all()
      .filter((e) => e.kind === ROUTINE_MEDITATE_EVENT && e.actors[0] === me && e.tick >= since);
    expect(sat).toEqual([]);
    expect(patchOf(w.map, at()).base).toBe(patchOf(w.map, home).base);
    expect(w.truth.get(LOCATION, me)?.space?.startsWith(`sect:${sect.seatPlace}/`) ?? false).toBe(
      false,
    );
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log })).toEqual([]);
  }, 590_000);
});
