// El ascenso (novel-sect-duty-rank): el externo que aportó las horas de tarea y cruzó el tramo de
// cultivo pasa a interno en su sede, con un evento causado por los puntos y el cultivo; desde ahí
// la cueva le queda abierta. Sin el tramo, por más tareas que haga, sigue externo.

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
  ART_KNOWN,
  BODY_STATE,
  CULTIVATION_STATE,
  caveBarred,
  checkInvariants,
  LOCATION,
  PLACE,
  PROMOTION_CHORE_HOURS,
  PROMOTION_STAGE,
  promotionDue,
  SECT,
  SECT_CONTRIBUTION,
  SECT_MEMBER,
  SECT_PROMOTED_EVENT,
  SECT_SCHOOL,
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

const chore = (actor: AgentId, hours: number): ActionPlan => ({
  actor,
  source: "player",
  root: { kind: "do", verb: "chore", args: [{ role: "for", seconds: hours * HOUR }], manner: [] },
  manner: [],
  causes: [{ kind: "state", entity: actor, key: "intent" }],
});

describe("el ascenso en la secta", () => {
  it("pide las horas de tarea en esa secta y el tramo de cultivo", () => {
    const org = "org:1" as EntityRef;
    const outer = { org, rank: "outer" as const, since: 0 };
    const enough = { org, points: 0, hours: PROMOTION_CHORE_HOURS, last: 0 };
    expect(promotionDue(outer, enough, PROMOTION_STAGE)).toBe(true);
    expect(promotionDue(outer, enough, PROMOTION_STAGE - 1)).toBe(false);
    expect(promotionDue(outer, { ...enough, hours: PROMOTION_CHORE_HOURS - 1 }, 9)).toBe(false);
    expect(promotionDue(outer, { ...enough, org: "org:2" as EntityRef }, 9)).toBe(false);
    expect(promotionDue({ ...outer, rank: "inner" }, enough, 9)).toBe(false);
  });

  it("en la sede, la tarea que completa el aporte lo sube a interno si ya cruzó el tramo", () => {
    const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
    const life = Life.create(3, content, { cultivation: true, sectSeatRegion: true });
    const w = life.world;
    const me = life.player;
    const ref = me as unknown as EntityRef;
    const org = w.truth.ids(SECT)[0] as EntityRef;
    const sect = w.truth.get(SECT, org);
    if (!sect) throw new Error("sin secta");
    const hex = w.truth.get(PLACE, sect.seatPlace)?.hexes[0] as number;
    const rested = () => {
      const body = w.truth.get(BODY_STATE, me);
      if (body) w.truth.set(BODY_STATE, me, { ...body, sleepDebt: 0, fatigue: 0, water: 0 });
    };
    const stageTo = (stage: number) => {
      const s = w.truth.get(CULTIVATION_STATE, ref) ?? { sensitivity: 0, hours: 0 };
      w.truth.set(CULTIVATION_STATE, me, { ...s, stage });
    };
    const promoted = () =>
      w.log.all().filter((e) => e.kind === SECT_PROMOTED_EVENT && e.actors[0] === me);
    w.truth.set(SECT_MEMBER, me, { org, rank: "outer", since: life.now });
    w.truth.set(SECT_CONTRIBUTION, me, {
      org,
      points: 0,
      hours: PROMOTION_CHORE_HOURS - 1,
      last: life.now,
    });
    w.truth.set(LOCATION, me, { hex, space: sectSpaceKey(sect.seatPlace, "hall") });

    // Sin el tramo: completa las horas y sigue externo.
    stageTo(0);
    rested();
    life.turn(chore(me, 2), 1);
    expect(promoted()).toHaveLength(0);
    expect(w.truth.get(SECT_MEMBER, ref)?.rank).toBe("outer");

    // Con el tramo: la próxima tarea anotada lo sube.
    stageTo(PROMOTION_STAGE);
    rested();
    const from = life.now;
    const report = life.turn(chore(me, 1), 1);
    const action = report.events.find((e) => e.kind === "action.chore" && e.actors[0] === me);
    const [up] = promoted();
    expect(up?.data).toMatchObject({ org, from: "outer", to: "inner", stage: PROMOTION_STAGE });
    expect(up?.causes).toEqual([
      { kind: "event", event: action?.id },
      { kind: "state", entity: me, key: SECT_CONTRIBUTION.name },
      { kind: "state", entity: me, key: CULTIVATION_STATE.name },
    ]);
    expect(w.truth.get(SECT_MEMBER, ref)?.rank).toBe("inner");
    // Y aprende la técnica de ataque de la escuela por ese ascenso (novel3-technique-school).
    const art = w.truth.get(SECT_SCHOOL, org)?.art;
    expect(art).toBeDefined();
    expect(w.truth.get(ART_KNOWN, ref)).toEqual({
      org,
      name: art?.name,
      learnedAt: up?.tick,
      event: up?.id,
    });
    expect(caveBarred(w.truth, ref, sectSpaceKey(sect.seatPlace, "cave"))).toBe(false);
    expect(playerView(w, [], { heardSince: from }).self.cues).toContain("promoted");

    // Ya interno: más tareas no repiten el ascenso.
    rested();
    life.turn(chore(me, 1), 1);
    expect(promoted()).toHaveLength(1);
    expect(checkInvariants({ truth: w.truth, log: w.log })).toEqual([]);
  }, 180_000);
});
