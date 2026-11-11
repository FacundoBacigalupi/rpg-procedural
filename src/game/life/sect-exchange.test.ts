// El canje de aportes (novel-sect-duty-exchange): en la sede, el externo canjea puntos de
// contribución por horas de pase a la cueva; se descuentan los puntos, el pase se suma y queda un
// evento causado por el pedido y los puntos. Sin puntos, sin ser de la secta o con rango para entrar,
// la secta no canjea y el personaje lo sabe.

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
  CAVE_PASS_POINTS_PER_HOUR,
  checkInvariants,
  exchangeHours,
  LOCATION,
  PLACE,
  REDEEM_DEFAULT_HOURS,
  SECT,
  SECT_CAVE_PASS,
  SECT_CONTRIBUTION,
  SECT_EXCHANGE_EVENT,
  SECT_MEMBER,
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

const redeem = (actor: AgentId, hours?: number): ActionPlan => ({
  actor,
  source: "player",
  root: {
    kind: "do",
    verb: "redeem",
    args: [
      ...(hours ? [{ role: "for", seconds: hours * HOUR }] : []),
      { role: "what", text: "cueva" },
    ],
    manner: [],
  },
  manner: [],
  causes: [{ kind: "state", entity: actor, key: "intent" }],
});

describe("el canje de aportes", () => {
  it("da lo pedido o lo que alcance, en horas enteras", () => {
    const rate = CAVE_PASS_POINTS_PER_HOUR;
    expect(exchangeHours(10 * rate, 3)).toEqual({ hours: 3, cost: 3 * rate });
    expect(exchangeHours(2 * rate + 1, 5)).toEqual({ hours: 2, cost: 2 * rate });
    expect(exchangeHours(100 * rate, null).hours).toBe(REDEEM_DEFAULT_HOURS);
    expect(exchangeHours(rate - 0.5, 3)).toEqual({ hours: 0, cost: 0 });
  });

  it("en la sede, el externo canjea puntos por pase; sin puntos o sin ser de la secta, no", () => {
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
    const exchanges = (from: number) =>
      w.log
        .all()
        .filter((e) => e.kind === SECT_EXCHANGE_EVENT && e.actors[0] === me && e.tick >= from);
    const rate = CAVE_PASS_POINTS_PER_HOUR;
    w.truth.set(LOCATION, me, { hex, space: sectSpaceKey(sect.seatPlace, "hall") });

    // Sin ser de la secta: nada.
    rested();
    let from = life.now;
    life.turn(redeem(me, 2), 1);
    expect(exchanges(from)[0]?.data).toMatchObject({ refused: "not_member", hours: 0 });
    expect(w.truth.has(SECT_CAVE_PASS, ref)).toBe(false);
    expect(playerView(w, [], { heardSince: from }).self.cues).toContain("exchange_refused");

    // Externo con puntos para cinco horas: pide tres y se las dan.
    w.truth.set(SECT_MEMBER, me, { org, rank: "outer", since: life.now });
    w.truth.set(SECT_CONTRIBUTION, me, { org, points: 5 * rate, hours: 5, last: life.now });
    rested();
    from = life.now;
    const report = life.turn(redeem(me, 3), 1);
    const action = report.events.find((e) => e.kind === "action.redeem" && e.actors[0] === me);
    const [done] = exchanges(from);
    expect(done?.data).toMatchObject({ org, hours: 3, points: 3 * rate, wanted: 3 });
    expect(done?.causes).toEqual([
      { kind: "event", event: action?.id },
      { kind: "state", entity: me, key: SECT_CONTRIBUTION.name },
    ]);
    expect(w.truth.get(SECT_CONTRIBUTION, ref)?.points).toBe(2 * rate);
    expect(w.truth.get(SECT_CAVE_PASS, ref)).toMatchObject({ org, hours: 3 });
    expect(playerView(w, [], { heardSince: from }).self.cues).toContain("exchange_done");

    // Sin decir cuántas: las de siempre, pero alcanza para dos; se suman al pase.
    rested();
    from = life.now;
    life.turn(redeem(me), 1);
    expect(exchanges(from)[0]?.data).toMatchObject({ hours: 2, wanted: null });
    expect(w.truth.get(SECT_CONTRIBUTION, ref)?.points).toBe(0);
    expect(w.truth.get(SECT_CAVE_PASS, ref)?.hours).toBe(5);

    // Ya sin puntos: no hay canje.
    rested();
    from = life.now;
    life.turn(redeem(me, 1), 1);
    expect(exchanges(from)[0]?.data).toMatchObject({ refused: "no_points" });
    expect(w.truth.get(SECT_CAVE_PASS, ref)?.hours).toBe(5);

    // El interno no lo necesita.
    w.truth.set(SECT_MEMBER, me, { org, rank: "inner", since: life.now });
    w.truth.set(SECT_CONTRIBUTION, me, { org, points: 4 * rate, hours: 4, last: life.now });
    rested();
    from = life.now;
    life.turn(redeem(me, 1), 1);
    expect(exchanges(from)[0]?.data).toMatchObject({ refused: "no_need" });
    expect(w.truth.get(SECT_CONTRIBUTION, ref)?.points).toBe(4 * rate);
    expect(checkInvariants({ truth: w.truth, log: w.log })).toEqual([]);
  }, 180_000);
});
