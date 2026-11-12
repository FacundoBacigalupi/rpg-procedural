// Las tareas de discípulo (novel-sect-duty-chore): en la sede, `chore` barre, monta guardia o junta
// leña; al miembro se le anotan puntos de contribución por las horas y cómo salió; al que no es de la
// secta, nadie le anota nada.

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
  type ActionPlan,
  BODY_STATE,
  checkInvariants,
  choreOf,
  chorePoints,
  LOCATION,
  PLACE,
  SECT,
  SECT_CHORE_EVENT,
  SECT_CONTRIBUTION,
  SECT_MEMBER,
  sectSpaceKey,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";
import { ROUTINE_CHORE_EVENT } from "./sect-duty.ts";
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

const chore = (actor: AgentId, hours: number, what?: string): ActionPlan => ({
  actor,
  source: "player",
  root: {
    kind: "do",
    verb: "chore",
    args: [{ role: "for", seconds: hours * HOUR }, ...(what ? [{ role: "what", text: what }] : [])],
    manner: [],
  },
  manner: [],
  causes: [{ kind: "state", entity: actor, key: "intent" }],
});

describe("tareas de discípulo", () => {
  it("la tarea es la que se dice o la del lugar; los puntos, por horas y cómo salió", () => {
    expect(choreOf("barrer", "sect:p/gate")).toBe("sweep");
    expect(choreOf("guardia", "sect:p/hall")).toBe("guard");
    expect(choreOf(undefined, "sect:p/gate")).toBe("guard");
    expect(choreOf(undefined, "sect:p/hall")).toBe("sweep");
    expect(choreOf(undefined, undefined)).toBe("firewood");
    expect(chorePoints(4, "success")).toBe(4);
    expect(chorePoints(4, "partial")).toBe(2);
    expect(chorePoints(4, "failure")).toBe(0);
    expect(chorePoints(4, "critical", 3)).toBe(4);
    expect(chorePoints(4, "critical", -3)).toBe(0);
  });

  it("en la sede, al miembro se le anotan puntos; al que no es de la secta, nada", () => {
    const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
    const life = Life.create(3, content, { cultivation: true, sectSeatRegion: true });
    const w = life.world;
    const me = life.player;
    const org = w.truth.ids(SECT)[0] as EntityRef;
    const sect = w.truth.get(SECT, org);
    if (!sect) throw new Error("sin secta");
    const hex = w.truth.get(PLACE, sect.seatPlace)?.hexes[0] as number;
    const rested = () => {
      const body = w.truth.get(BODY_STATE, me);
      if (body) w.truth.set(BODY_STATE, me, { ...body, sleepDebt: 0, fatigue: 0, water: 0 });
    };
    const chores = (from: number) =>
      w.log
        .all()
        .filter((e) => e.kind === SECT_CHORE_EVENT && e.actors[0] === me && e.tick >= from);

    // Sin ser de la secta: trabaja de balde.
    w.truth.set(LOCATION, me, { hex, space: sectSpaceKey(sect.seatPlace, "hall") });
    rested();
    let from = life.now;
    life.turn(chore(me, 2), 1);
    const unpaid = chores(from);
    expect(unpaid).toHaveLength(1);
    expect(unpaid[0]?.data).toMatchObject({ task: "sweep", credited: false, points: 0 });
    expect(w.truth.has(SECT_CONTRIBUTION, me)).toBe(false);
    expect(playerView(w, [], { heardSince: from }).self.cues).toContain("chore_unpaid");

    // Discípulo externo, en el portón: «barro» es barrer, aunque el portón sea de guardia.
    w.truth.set(SECT_MEMBER, me, { org, rank: "outer", since: life.now });
    w.truth.set(LOCATION, me, { hex, space: sectSpaceKey(sect.seatPlace, "gate") });
    rested();
    from = life.now;
    const report = life.turn(chore(me, 3, "barrer"), 1);
    const action = report.events.find((e) => e.kind === "action.chore" && e.actors[0] === me);
    expect(action).toBeDefined();
    const [done] = chores(from);
    expect(done?.data).toMatchObject({ task: "sweep", credited: true, org, hours: 3 });
    expect(done?.causes).toEqual([{ kind: "event", event: action?.id }]);
    const points = (done?.data as { points: number } | undefined)?.points;
    expect(points).toBe(
      chorePoints(
        3,
        action?.outcome as string | undefined,
        (action?.data as { margin: number } | undefined)?.margin,
      ),
    );
    expect(w.truth.get(SECT_CONTRIBUTION, me)).toMatchObject({ org, points, hours: 3 });
    expect(playerView(w, [], { heardSince: from }).self.cues).toContain("chore_credited");

    // Sin decir qué, en el portón: guardia; se suma a lo anotado.
    rested();
    from = life.now;
    life.turn(chore(me, 2), 1);
    expect(chores(from)[0]?.data).toMatchObject({ task: "guard", credited: true });
    expect(w.truth.get(SECT_CONTRIBUTION, me)?.hours).toBe(5);
    expect(checkInvariants({ truth: w.truth, log: w.log })).toEqual([]);
  }, 120_000);
  it("el externo que ya subió, si delega el día, hace tareas en las horas de trabajo (routine)", () => {
    const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
    const life = Life.create(3, content, { cultivation: true, sectSeatRegion: true });
    const w = life.world;
    const me = life.player;
    const org = w.truth.ids(SECT)[0] as EntityRef;
    const sect = w.truth.get(SECT, org);
    if (!sect) throw new Error("sin secta");
    const hex = w.truth.get(PLACE, sect.seatPlace)?.hexes[0] as number;
    w.truth.set(SECT_MEMBER, me, { org, rank: "outer", since: life.now });
    w.truth.set(LOCATION, me, { hex, space: sectSpaceKey(sect.seatPlace, "hall") });
    const from = life.now;
    const day: ActionPlan = {
      actor: me,
      source: "routine",
      root: { kind: "do", verb: "wait", args: [{ role: "for", seconds: 24 * HOUR }], manner: [] },
      manner: [],
      causes: [{ kind: "state", entity: me, key: "intent" }],
    };
    life.turn(day, 1);
    const hours = w.log
      .all()
      .filter((e) => e.kind === ROUTINE_CHORE_EVENT && e.actors[0] === me && e.tick >= from);
    expect(hours.length).toBeGreaterThan(0);
    const credited = w.log
      .all()
      .filter((e) => e.kind === SECT_CHORE_EVENT && e.actors[0] === me && e.tick >= from);
    expect(credited.length).toBe(hours.length);
    expect(credited.every((e) => (e.data as { credited?: boolean }).credited === true)).toBe(true);
    expect(w.truth.get(SECT_CONTRIBUTION, me)?.hours).toBe(hours.length);
    // Sigue en la sede: no bajó a los campos de la aldea.
    const at = w.truth.get(LOCATION, me);
    expect(at?.space?.startsWith(`sect:${sect.seatPlace}/`)).toBe(true);
    expect(checkInvariants({ truth: w.truth, log: w.log })).toEqual([]);
  }, 120_000);
});
