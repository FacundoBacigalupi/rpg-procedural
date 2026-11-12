// El pabellón de escrituras (novel2-method-pavilion): en la sede, quien llegó a la cima del reino que
// cubre su método canjea puntos por el método del reino siguiente (o se lo da su rango); antes de la
// cima o sin puntos, no, y el personaje lo sabe.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  type EntityRef,
  type EventId,
  loadContent,
} from "../../core/index.ts";
import {
  type ActionPlan,
  BODY_STATE,
  CULTIVATION_STATE,
  CULTIVATION_TECHNIQUE,
  checkInvariants,
  LOCATION,
  METHOD_POINTS_PER_REALM,
  PLACE,
  SECT,
  SECT_CONTRIBUTION,
  SECT_EXCHANGE_EVENT,
  SECT_MEMBER,
  SECT_SCHOOL,
  sectSpaceKey,
  TECHNIQUE_TAUGHT_EVENT,
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

const askMethod = (actor: AgentId): ActionPlan => ({
  actor,
  source: "player",
  root: { kind: "do", verb: "redeem", args: [{ role: "what", text: "técnica" }], manner: [] },
  manner: [],
  causes: [{ kind: "state", entity: actor, key: "intent" }],
});

describe("el pabellón de escrituras (novel2-method-pavilion)", () => {
  it("da el método siguiente en la cima del reino, por puntos o por rango", () => {
    const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
    const life = Life.create(3, content, { cultivation: true, sectSeatRegion: true });
    const w = life.world;
    const me = life.player;
    const ref = me as unknown as EntityRef;
    const org = w.truth.ids(SECT)[0] as EntityRef;
    const sect = w.truth.get(SECT, org);
    const school = w.truth.get(SECT_SCHOOL, org);
    if (!sect || !school) throw new Error("sin secta o sin escuela");
    const second = school.methods?.[1];
    if (!second) throw new Error("sin método del segundo reino");
    const top = school.realms[0]?.to ?? 0;
    const hex = w.truth.get(PLACE, sect.seatPlace)?.hexes[0] as number;
    const rested = () => {
      const body = w.truth.get(BODY_STATE, me);
      if (body) w.truth.set(BODY_STATE, me, { ...body, sleepDebt: 0, fatigue: 0, water: 0 });
      w.truth.set(LOCATION, me, { hex, space: sectSpaceKey(sect.seatPlace, "hall") });
    };
    const atStage = (stage: number) =>
      w.truth.set(CULTIVATION_STATE, me, {
        sensitivity: 2,
        hours: 500,
        sensed: { at: life.now, event: w.log.all()[0]?.id as EventId },
        stage,
      });
    const entry = () =>
      w.truth.set(CULTIVATION_TECHNIQUE, me, {
        org,
        name: school.technique.name,
        factor: school.technique.factor,
        learnedAt: life.now,
        realm: 0,
      });
    const exchanges = (from: number) =>
      w.log
        .all()
        .filter((e) => e.kind === SECT_EXCHANGE_EVENT && e.actors[0] === me && e.tick >= from);
    const cost = METHOD_POINTS_PER_REALM;
    w.truth.set(SECT_MEMBER, me, { org, rank: "outer", since: life.now });
    entry();

    // Lejos de la cima: todavía no.
    atStage(0);
    w.truth.set(SECT_CONTRIBUTION, me, { org, points: cost * 2, hours: 1, last: life.now });
    rested();
    let from = life.now;
    life.turn(askMethod(me), 1);
    expect(exchanges(from)[0]?.data).toMatchObject({ what: "method", refused: "too_soon" });
    expect(w.truth.get(CULTIVATION_TECHNIQUE, ref)?.realm).toBe(0);
    expect(playerView(w, [], { heardSince: from }).self.cues).toContain("method_too_soon");

    // En la cima, sin puntos suficientes: no.
    atStage(top);
    w.truth.set(SECT_CONTRIBUTION, me, { org, points: cost - 1, hours: 1, last: life.now });
    rested();
    from = life.now;
    life.turn(askMethod(me), 1);
    expect(exchanges(from)[0]?.data).toMatchObject({ refused: "no_points", realm: 1 });
    expect(playerView(w, [], { heardSince: from }).self.cues).toContain("method_no_points");

    // Con puntos: el método del segundo reino, descontado, causado por el pedido.
    w.truth.set(SECT_CONTRIBUTION, me, { org, points: cost + 5, hours: 1, last: life.now });
    rested();
    from = life.now;
    const report = life.turn(askMethod(me), 1);
    const action = report.events.find((e) => e.kind === "action.redeem" && e.actors[0] === me);
    expect(exchanges(from)[0]?.data).toMatchObject({
      org,
      what: "method",
      realm: 1,
      technique: second.name,
      points: cost,
    });
    expect(w.truth.get(SECT_CONTRIBUTION, ref)?.points).toBe(5);
    expect(w.truth.get(CULTIVATION_TECHNIQUE, ref)).toMatchObject({
      org,
      name: second.name,
      factor: second.factor,
      realm: 1,
    });
    const taught = w.log
      .all()
      .find((e) => e.kind === TECHNIQUE_TAUGHT_EVENT && e.actors[0] === me && e.tick >= from);
    expect(taught?.causes[0]).toEqual({ kind: "event", event: action?.id });
    const self = playerView(w, [], { heardSince: from }).self;
    expect(self.cues).toContain("method_given");
    expect(self.cues).not.toContain("technique_taught");
    expect(self.cues).not.toContain("exchange_done");
    expect(self.technique).toBe(second.name);

    // Al interno se lo dan sin cobrar.
    entry();
    w.truth.set(SECT_MEMBER, me, { org, rank: "inner", since: life.now });
    w.truth.set(SECT_CONTRIBUTION, me, { org, points: 0, hours: 1, last: life.now });
    rested();
    from = life.now;
    life.turn(askMethod(me), 1);
    expect(exchanges(from)[0]?.data).toMatchObject({ realm: 1, points: 0 });
    expect(w.truth.get(CULTIVATION_TECHNIQUE, ref)?.realm).toBe(1);
    expect(checkInvariants({ truth: w.truth, log: w.log })).toEqual([]);
  }, 600_000);
});
