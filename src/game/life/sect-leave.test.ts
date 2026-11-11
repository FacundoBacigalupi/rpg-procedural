// El permiso y la ausencia (novel-sect-seat-return-leave): en la sede, `furlough` da días de permiso
// al miembro (al que no es, nada); la secta anota cuándo sale del parche y con qué plazo, cuándo se
// pasa y, al volver, descuenta aporte por los días de más. Sin permiso hay un día de gracia.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  type EntityRef,
  HOUR,
  loadContent,
  type Tick,
} from "../../core/index.ts";
import {
  ABSENCE_GRACE_DAYS,
  ABSENCE_POINTS_PER_DAY,
  type ActionPlan,
  absenceDue,
  absencePenalty,
  BODY_STATE,
  checkInvariants,
  LEAVE_DEFAULT_DAYS,
  LEAVE_MAX_DAYS,
  LOCATION,
  lateDays,
  leaveDays,
  PLACE,
  SECT,
  SECT_CONTRIBUTION,
  SECT_LEAVE,
  SECT_LEAVE_EVENT,
  SECT_LEFT_EVENT,
  SECT_MEMBER,
  SECT_OVERDUE_EVENT,
  SECT_PRESENCE,
  SECT_RETURNED_EVENT,
  sectSpaceKey,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";
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

const furlough = (actor: AgentId, days?: number): ActionPlan => ({
  actor,
  source: "player",
  root: {
    kind: "do",
    verb: "furlough",
    args: days ? [{ role: "for", seconds: days * 24 * HOUR }] : [],
    manner: [],
  },
  manner: [],
  causes: [{ kind: "state", entity: actor, key: "intent" }],
});

describe("permiso y ausencia de la sede", () => {
  it("los días de permiso, el plazo, el atraso y la pena", () => {
    expect(leaveDays(null)).toBe(LEAVE_DEFAULT_DAYS);
    expect(leaveDays(2.2)).toBe(3);
    expect(leaveDays(400)).toBe(LEAVE_MAX_DAYS);
    expect(leaveDays(0)).toBe(1);
    const day = 100;
    const free = { org: "org:1" as EntityRef, away: true, since: 1000 as Tick };
    expect(absenceDue(free, day)).toBe(1000 + ABSENCE_GRACE_DAYS * day);
    expect(absenceDue({ ...free, until: 1500 as Tick }, day)).toBe(1500);
    expect(lateDays({ ...free, until: 1500 as Tick }, 1400 as Tick, day)).toBe(0);
    expect(lateDays({ ...free, until: 1500 as Tick }, 1750 as Tick, day)).toBe(2.5);
    expect(absencePenalty(50, 0)).toBe(0);
    expect(absencePenalty(50, 2.5)).toBe(3 * ABSENCE_POINTS_PER_DAY);
    expect(absencePenalty(1, 2.5)).toBe(1);
  });

  it("con permiso sale anotado; pasado el plazo pierde aporte; sin permiso, un día de gracia", () => {
    const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
    const life = Life.create(3, content, { cultivation: true, sectSeatRegion: true });
    const w = life.world;
    const me = life.player;
    const day = w.clock.day;
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
    const last = (kind: string) =>
      w.log
        .all()
        .filter((e) => e.kind === kind && e.actors[0] === me)
        .at(-1);
    const cues = (from: number) => playerView(w, [], { heardSince: from }).self.cues;

    // Sin ser de la secta: nadie le da permiso, y nadie le cuenta la ausencia.
    w.truth.set(LOCATION, me, hall);
    rested();
    let from = life.now;
    life.turn(furlough(me, 3), 1);
    expect(last(SECT_LEAVE_EVENT)?.data).toEqual({ refused: "not_member" });
    expect(w.truth.has(SECT_LEAVE, me)).toBe(false);
    expect(cues(from)).toContain("leave_refused");
    expect(w.truth.has(SECT_PRESENCE, me)).toBe(false);

    // Interno con aporte, en la sede: la secta lo cuenta presente.
    w.truth.set(SECT_MEMBER, me, { org, rank: "inner", since: life.now });
    w.truth.set(SECT_CONTRIBUTION, me, { org, points: 50, hours: 30, last: life.now });
    life.advanceTo(life.now + 2 * HOUR);
    expect(w.truth.get(SECT_PRESENCE, me)).toMatchObject({ org, away: false });

    // Pide un día de permiso.
    rested();
    from = life.now;
    const report = life.turn(furlough(me, 1), 2);
    const asked = report.events.find((e) => e.kind === "action.furlough");
    const granted = last(SECT_LEAVE_EVENT);
    expect(granted?.data).toMatchObject({ org, days: 1 });
    expect(granted?.causes).toEqual([{ kind: "event", event: asked?.id }]);
    const leave = w.truth.get(SECT_LEAVE, me);
    expect(leave?.until).toBe((leave?.from ?? 0) + day);
    expect(cues(from)).toContain("leave_granted");

    // Baja a la aldea: sale anotado con el plazo del permiso.
    w.truth.set(LOCATION, me, { hex: village });
    life.advanceTo(life.now + 2 * HOUR);
    const left = last(SECT_LEFT_EVENT);
    expect(left?.data).toMatchObject({ org, leave: true, until: leave?.until });
    expect(left?.causes).toContainEqual({ kind: "state", entity: me, key: SECT_LEAVE.name });
    expect(w.truth.get(SECT_PRESENCE, me)).toMatchObject({ away: true, until: leave?.until });

    // Se pasa del plazo: la secta lo anota una vez.
    rested();
    life.advanceTo((leave?.until ?? 0) + 3 * HOUR);
    expect(w.log.all().filter((e) => e.kind === SECT_OVERDUE_EVENT)).toHaveLength(1);
    expect(w.truth.get(SECT_PRESENCE, me)?.overdue).toBe(true);

    // Vuelve: menos de un día de más cuenta como uno.
    w.truth.set(LOCATION, me, hall);
    from = life.now;
    life.advanceTo(life.now + HOUR);
    const back = last(SECT_RETURNED_EVENT);
    expect(back?.data).toMatchObject({ org, leave: true, penalty: ABSENCE_POINTS_PER_DAY });
    expect((back?.data as { late?: number } | undefined)?.late).toBeGreaterThan(0);
    expect(back?.causes).toEqual([{ kind: "state", entity: me, key: SECT_PRESENCE.name }]);
    expect(w.truth.get(SECT_CONTRIBUTION, me)?.points).toBe(50 - ABSENCE_POINTS_PER_DAY);
    expect(w.truth.get(SECT_PRESENCE, me)).toMatchObject({ away: false });
    expect(cues(from)).toContain("returned_late");

    // Sin permiso (el anterior venció) y de vuelta en unas horas: dentro del día de gracia.
    w.truth.set(LOCATION, me, { hex: village });
    life.advanceTo(life.now + 2 * HOUR);
    expect(last(SECT_LEFT_EVENT)?.data).toEqual({ org, leave: false });
    w.truth.set(LOCATION, me, hall);
    from = life.now;
    life.advanceTo(life.now + 2 * HOUR);
    expect(last(SECT_RETURNED_EVENT)?.data).toMatchObject({ late: 0, penalty: 0, leave: false });
    expect(w.truth.get(SECT_CONTRIBUTION, me)?.points).toBe(50 - ABSENCE_POINTS_PER_DAY);
    expect(cues(from)).toContain("returned_on_time");
    expect(checkInvariants({ truth: w.truth, log: w.log })).toEqual([]);
  }, 300_000);
});
