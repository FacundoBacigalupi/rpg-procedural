// La misión de cazar al lobo (novel3-beasts-mission-ask): un miembro de la secta vio al lobo que bajó
// (`BEAST_SEEN`); al pedirle una misión al anciano, le da la de cazarlo antes que las de hierbas, con
// plazo hasta que vuelve al monte. Una por bestia.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, type EntityRef, loadContent } from "../../core/index.ts";
import {
  type ActionPlan,
  BEAST,
  BEAST_SEEN,
  BODY_STATE,
  checkInvariants,
  LOCATION,
  MISSION_ASSIGNED_EVENT,
  PLACE,
  SECT,
  SECT_MEMBER,
  SECT_MISSION,
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

const say = (actor: AgentId, to: AgentId, text: string): ActionPlan => ({
  actor,
  source: "player",
  root: {
    kind: "do",
    verb: "speak",
    args: [
      { role: "to", entity: to },
      { role: "content", text },
    ],
    manner: [],
  },
  manner: [],
  causes: [{ kind: "state", entity: actor, key: "intent" }],
});

describe("la misión de cazar al lobo (novel3-beasts-mission-ask)", () => {
  const content = loadContent(GAME_CONTENT_KINDS, sources("content"));

  const run = () => {
    const life = Life.create(3, content, { cultivation: true, sectSeatRegion: true });
    const w = life.world;
    const me = life.player;
    const org = w.truth.ids(SECT)[0] as EntityRef;
    const seat = w.truth.get(SECT, org)?.seatPlace as EntityRef;
    const wilds = w.truth.get(WILDS, seat);
    if (!wilds) throw new Error("sin monte en la sede");
    w.truth.set(WILDS, seat, { ...wilds, populations: [{ lineage: "wolf", count: 200 }] });
    const hex = w.truth.get(PLACE, seat)?.hexes[0] as number;
    w.truth.set(SECT_MEMBER, me, { org, rank: "outer", since: life.now });
    w.truth.set(LOCATION, me, { hex });
    life.advanceTo(life.now + DAY + 2 * 3600);
    const wolf = [...w.truth.ids(BEAST)][0] as EntityRef;
    expect(w.truth.get(BEAST_SEEN, wolf)?.org).toBe(org);
    const elder = w.truth
      .ids(SECT_MEMBER)
      .map((id) => ({ id: id as AgentId, m: w.truth.get(SECT_MEMBER, id) }))
      .find(
        (x) => x.m?.org === org && x.id !== me && (x.m.rank === "elder" || x.m.rank === "master"),
      )?.id;
    if (!elder) throw new Error("sin anciano");
    const here = w.truth.get(LOCATION, me);
    if (!here) throw new Error("sin lugar");
    w.truth.set(LOCATION, elder, here);
    for (const id of [me, elder]) {
      const body = w.truth.get(BODY_STATE, id);
      if (body) w.truth.set(BODY_STATE, id, { ...body, sleepDebt: 0, fatigue: 0 });
    }
    const report = life.turn(say(me, elder, "Anciano, ¿hay alguna misión para mí?"), 1);
    const reply = report.events.find((e) => e.kind === "action.speak" && e.actors[0] === elder);
    return {
      life,
      w,
      me,
      org,
      wolf,
      elder,
      line: (reply?.data as { effect?: { reply: string } } | undefined)?.effect?.reply,
      assigned: report.events.find((e) => e.kind === MISSION_ASSIGNED_EVENT),
    };
  };

  it("el anciano da la de cazar al lobo visto, con plazo hasta que vuelve", () => {
    const { life, w, me, org, wolf, elder, line, assigned } = run();
    expect(line).toBe("mission.give.hunt");
    const mission = w.truth.get(SECT_MISSION, me);
    const until = w.truth.get(BEAST, wolf)?.until;
    expect(mission).toMatchObject({ org, kind: "hunt", beast: wolf, by: elder, done: 0, until });
    expect(mission?.points).toBeGreaterThan(0);
    expect(mission?.due).toBe(until);
    expect(mission?.due).toBeGreaterThan(life.now);
    expect(mission?.cause).toBe(assigned?.id);
    expect(checkInvariants({ truth: w.truth, log: w.log })).toEqual([]);
  }, 600_000);

  it("es determinista", () => {
    const a = run();
    const b = run();
    expect(a.w.truth.get(SECT_MISSION, a.me)).toEqual(b.w.truth.get(SECT_MISSION, b.me));
  }, 600_000);
});
