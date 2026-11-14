// La misión de cazar al lobo (novel3-beasts-mission-ask): un miembro de la secta vio al lobo que bajó
// (`BEAST_SEEN`); al pedirle una misión al anciano, le da la de cazarlo antes que las de hierbas, con
// plazo hasta que vuelve al monte. Una por bestia. Se cobra (novel3-beasts-mission-claim) al estar en
// la sede después de pelear con el lobo y que muriera o huyera; si vuelve al monte sin pelea, vence.

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
  MISSION_DONE_EVENT,
  MISSION_LAPSED_EVENT,
  PLACE,
  SECT,
  SECT_CONTRIBUTION,
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

const hit = (actor: AgentId, target: EntityRef): ActionPlan => ({
  actor,
  source: "player",
  root: { kind: "do", verb: "strike", args: [{ role: "target", entity: target }], manner: [] },
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

  it("pelear hasta que muere o huye y estar en la sede la cobra", () => {
    const { life, w, me, wolf, assigned } = run();
    const before = w.truth.get(SECT_CONTRIBUTION, me)?.points ?? 0;
    const from = life.now;
    // Un lobo flaco y desangrado: la pelea se resuelve en pocos golpes.
    const weak = w.truth.get(BODY_STATE, wolf);
    if (weak) w.truth.set(BODY_STATE, wolf, { ...weak, blood: 0.45, fatigue: 0.9 });
    const fights: string[] = [];
    for (let i = 0; i < 6; i++) {
      const wolfBody = w.truth.get(BODY_STATE, wolf);
      const mine = w.truth.get(BODY_STATE, me);
      if ((wolfBody?.death ?? null) !== null || (mine?.death ?? null) !== null) break;
      if (!w.truth.get(SECT_MISSION, me)) break;
      if (mine) w.truth.set(BODY_STATE, me, { ...mine, sleepDebt: 0, fatigue: 0 });
      life.turn(hit(me, wolf), 1);
      const last = w.log
        .all()
        .filter(
          (e) => e.kind === "combat.fight" && e.tick >= from && e.actors.includes(wolf as never),
        )
        .at(-1);
      fights.push(String((last?.data as { outcomes?: Record<string, string> })?.outcomes?.[wolf]));
      if (fights.at(-1) === "fled") break;
    }
    const done = w.log.all().find((e) => e.tick >= from && e.kind === MISSION_DONE_EVENT);
    expect(done?.actors).toEqual([me]);
    expect(done?.data).toMatchObject({ kind: "hunt", beast: wolf });
    expect(done?.causes).toContainEqual({ kind: "event", event: assigned?.id });
    expect(w.truth.get(SECT_MISSION, me)).toBeUndefined();
    expect(w.truth.get(SECT_CONTRIBUTION, me)?.points).toBeGreaterThan(before);
    expect(checkInvariants({ truth: w.truth, log: w.log })).toEqual([]);
  }, 600_000);

  it("si vuelve al monte sin pelea, vence", () => {
    const { life, w, me, wolf } = run();
    const until = w.truth.get(BEAST, wolf)?.until as number;
    const hex = w.truth.get(LOCATION, me)?.hex as number;
    const elsewhere = [...w.truth.ids(PLACE)]
      .map((id) => w.truth.get(PLACE, id)?.hexes[0])
      .find((h) => h !== undefined && h !== hex) as number;
    w.truth.set(LOCATION, me, { hex: elsewhere });
    const from = life.now;
    life.advanceTo(until + 3600);
    const lapsed = w.log.all().find((e) => e.tick >= from && e.kind === MISSION_LAPSED_EVENT);
    expect(lapsed?.data).toMatchObject({ kind: "hunt" });
    expect(w.log.all().some((e) => e.tick >= from && e.kind === MISSION_DONE_EVENT)).toBe(false);
    expect(w.truth.get(SECT_MISSION, me)).toBeUndefined();
  }, 600_000);

  it("es determinista", () => {
    const a = run();
    const b = run();
    expect(a.w.truth.get(SECT_MISSION, a.me)).toEqual(b.w.truth.get(SECT_MISSION, b.me));
  }, 600_000);
});
