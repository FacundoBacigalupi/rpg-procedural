// La guardia de cuerpo (novel4-watch-npc): si nadie tiene la guardia hacia la secta que amenaza, la
// secta manda a uno de los suyos libre de rango; va al puesto, espera las horas y vuelve a contar.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  type EntityRef,
  loadContent,
  type PlaceId,
} from "../../core/index.ts";
import {
  ACTIONS,
  ActionCatalog,
  BODY_STATE,
  checkInvariants,
  ENTITY,
  LOCATION,
  MISSION_ASSIGNED_EVENT,
  MISSION_DONE_EVENT,
  MISSION_PROGRESS_EVENT,
  MISSION_WATCH_HOURS,
  ORG_RELATION,
  PERSON,
  PLACE,
  PLANS,
  SECT,
  SECT_MEMBER,
  SECT_MISSION,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { PLAN_STATE } from "./act.ts";
import { NPC_DECISION } from "./decide.ts";
import { Life } from "./life.ts";
import { NPC_JOURNEY, planFromDecision } from "./npc-verbs.ts";
import { postPlaceAt, WATCH_SEND_EVERY_DAYS, watchDestination, watchPosts } from "./sect-watch.ts";
import { TRANSIT } from "./transit-state.ts";

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
const HOUR = 3600;
const YEAR = 365 * DAY;

describe("la guardia de cuerpo (novel4-watch-npc)", () => {
  const content = loadContent(GAME_CONTENT_KINDS, sources("content"));

  const setup = () => {
    const l = Life.create(3, content, {
      cultivation: true,
      rivalSect: true,
      npcJourneyDays: 30,
      npcVerbs: ["move"],
      npcMove: true,
      npcTransit: true,
      sectSeatRegion: true,
    });
    const t = l.world.truth;
    const [a, b] = t.ids(SECT) as EntityRef[];
    if (!a || !b) throw new Error("sin sectas");
    return { l, t, a, b };
  };

  it("el puesto es un lugar causado por la rivalidad", () => {
    const { l, t, a, b } = setup();
    const post = watchPosts(l.world.map)(t, a, b)?.hex;
    if (post === undefined) throw new Error("sin puesto");
    const place = postPlaceAt(t, post);
    expect(place).toBeDefined();
    expect(t.get(PLACE, place as EntityRef)).toEqual({ kind: "post", hexes: [post] });
    const origin = t.get(ENTITY, place as EntityRef)?.originEventId;
    expect(origin).toBe(t.get(ORG_RELATION, a)?.toward[b]?.originEventId);
  });

  it("una duración en el id de la decisión es la del verbo", () => {
    const catalog = new ActionCatalog(content.all(ACTIONS), content.all(PLANS));
    const me = "agent:1" as AgentId;
    expect(planFromDecision({ id: "wait:7200s", verb: "wait" }, catalog, me)?.root).toEqual({
      kind: "do",
      verb: "wait",
      args: [{ role: "for", seconds: 7200 }],
      manner: [],
    });
    expect(planFromDecision({ id: "wait:", verb: "wait" }, catalog, me)?.root).toMatchObject({
      args: [],
    });
  });

  it("sin nadie de guardia, la secta manda a uno; va, espera las horas y la cobra al volver", () => {
    const { l, t, a, b } = setup();
    const rel = t.get(ORG_RELATION, a);
    const tie = rel?.toward[b];
    if (!rel || !tie) throw new Error("sin relación");
    t.set(ORG_RELATION, a, {
      toward: { ...rel.toward, [b]: { ...tie, sentiment: { ...tie.sentiment, resentment: 0.8 } } },
    });
    for (const id of [...t.ids(SECT_MISSION)]) t.deleteRaw(SECT_MISSION.name, id);
    const alive = (id: AgentId) =>
      t.get(ENTITY, id)?.endedAt === undefined && (t.get(BODY_STATE, id)?.death ?? null) === null;
    const guard = (t.ids(PERSON) as AgentId[]).find(
      (id) =>
        alive(id) &&
        id !== l.player &&
        t.get(LOCATION, id) !== undefined &&
        l.now - (t.get(PERSON, id)?.born ?? l.now) > 20 * YEAR &&
        l.now - (t.get(PERSON, id)?.born ?? l.now) < 40 * YEAR,
    );
    if (!guard) throw new Error("sin aldeanos");
    // El único de rango de la secta: los demás que hubiera, afuera.
    for (const id of [...t.ids(SECT_MEMBER)] as AgentId[]) {
      const m = t.get(SECT_MEMBER, id);
      if (m?.org === a && (m.rank === "inner" || m.rank === "elder"))
        t.set(SECT_MEMBER, id, { ...m, rank: "outer" });
    }
    t.set(SECT_MEMBER, guard, { org: a, rank: "inner", since: l.now });
    // Vive en la sede, como los discípulos.
    const seatHex = t.get(PLACE, t.get(SECT, a)?.seatPlace as EntityRef)?.hexes[0] as number;
    t.set(LOCATION, guard, { hex: seatHex });
    const from = l.now;
    // Sin rutina de comer y beber en esta vida de prueba: se le repone el cuerpo cada día.
    const body0 = t.get(BODY_STATE, guard);
    if (!body0) throw new Error("sin cuerpo");
    const fed = () => t.set(BODY_STATE, guard, { ...body0, updatedAt: l.now });
    fed();
    for (let d = 1; d <= WATCH_SEND_EVERY_DAYS + 1; d++) {
      fed();
      l.advanceTo(from + d * DAY);
    }
    const sent = l.world.log
      .all()
      .filter((e) => e.kind === MISSION_ASSIGNED_EVENT && e.tick >= from && e.actors[0] === guard);
    expect(sent).toHaveLength(1);
    const post = watchPosts(l.world.map)(t, a, b)?.hex as number;
    const mission = t.get(SECT_MISSION, guard);
    expect(mission).toMatchObject({ org: a, kind: "watch", against: b, hex: post });
    // Sale de la sede (el aldeano hecho discípulo tiene la casa en la aldea): ahí, sin lo que ya andaba.
    t.set(LOCATION, guard, { hex: seatHex });
    for (const table of [TRANSIT, NPC_JOURNEY, PLAN_STATE]) t.deleteRaw(table.name, guard);
    // Va al puesto, espera las horas y vuelve; en la sede la cobra.
    const due = mission?.due ?? 0;
    const cashed = () =>
      l.world.log.all().find((e) => e.kind === MISSION_DONE_EVENT && e.actors[0] === guard);
    while (cashed() === undefined && l.now < due) {
      fed();
      l.advanceTo(l.now + DAY);
    }
    const done = cashed();
    expect(done?.data).toMatchObject({ kind: "watch", against: b });
    // Las horas se contaron en el puesto (después la secta puede volver a dársela).
    const watched = l.world.log
      .all()
      .filter((e) => e.kind === MISSION_PROGRESS_EVENT && e.actors[0] === guard);
    expect(watched.length).toBeGreaterThan(0);
    expect(
      watched.every((e) => e.place.kind === "place" && e.place.place === postPlaceAt(t, post)),
    ).toBe(true);
    expect(checkInvariants({ truth: l.world.truth, log: l.world.log })).toEqual([]);
  });

  it("qué hace el guardia: ir al puesto, esperar lo que falta, volver", () => {
    const { l, t, a, b } = setup();
    const post = watchPosts(l.world.map)(t, a, b)?.hex as number;
    const seat = t.get(SECT, a)?.seatPlace as PlaceId;
    const seatHex = t.get(PLACE, seat as unknown as EntityRef)?.hexes[0] as number;
    const who = l.player;
    t.set(LOCATION, who, { hex: seatHex });
    const m = {
      org: a,
      kind: "watch" as const,
      against: b,
      hex: post,
      hours: MISSION_WATCH_HOURS,
      done: 0,
      points: 16,
      by: who,
      at: l.now,
      due: l.now + 7 * DAY,
    };
    t.set(SECT_MISSION, who, m);
    expect(watchDestination(t, who)).toEqual({ kind: "go", place: postPlaceAt(t, post) });
    t.set(LOCATION, who, { hex: post });
    t.set(SECT_MISSION, who, { ...m, done: 2.5 });
    expect(watchDestination(t, who)).toEqual({
      kind: "wait",
      seconds: (MISSION_WATCH_HOURS - 2.5) * HOUR,
    });
    t.set(SECT_MISSION, who, { ...m, done: MISSION_WATCH_HOURS });
    expect(watchDestination(t, who)).toEqual({ kind: "go", place: seat });
    t.set(LOCATION, who, { hex: seatHex });
    expect(watchDestination(t, who)).toBeUndefined();
  });
});
