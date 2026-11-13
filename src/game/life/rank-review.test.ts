// La secta decide el ascenso (novel2-rank-review): el pedido que plantea un anciano lo decide en el
// mismo paso el maestro de la secta (o el anciano más alto en la sede), con las voces de los demás.
// El ascenso escribe el rango y desde cuándo; el rechazo deja una espera antes de volver a plantear.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  type EntityRef,
  type EventId,
  HOUR,
  loadContent,
  type PlaceRef,
  Rng,
} from "../../core/index.ts";
import {
  type ActionPlan,
  BODY_STATE,
  CULTIVATION_STATE,
  checkInvariants,
  LOCATION,
  normalize,
  PLACE,
  RANK_PETITION_EVENT,
  SECT,
  SECT_CONTRIBUTION,
  SECT_MEMBER,
  SECT_PROMOTED_EVENT,
  SECT_RANK_REFUSED_EVENT,
  SECT_RANK_RULING,
  SECT_TRIAL,
  type understand,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";
import { reviewRank } from "./rank-review.ts";

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}

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

const lex = { people: [], goods: [] } as unknown as Parameters<typeof understand>[1];

describe("la secta decide el ascenso (novel2-rank-review)", () => {
  it("sube al que de sobra cumple; con un rechazo reciente, el anciano no lo vuelve a plantear", () => {
    const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
    const life = Life.create(3, content, { cultivation: true, sectSeatRegion: true });
    const w = life.world;
    const me = life.player;
    const org = w.truth.ids(SECT)[0] as EntityRef;
    const sect = w.truth.get(SECT, org);
    if (!sect) throw new Error("sin secta");
    const hex = w.truth.get(PLACE, sect.seatPlace)?.hexes[0] as number;
    w.truth.set(LOCATION, me, { hex });
    life.advanceTo(life.now + 2 * HOUR);
    const members = w.truth
      .ids(SECT_MEMBER)
      .map((id) => ({ id: id as AgentId, m: w.truth.get(SECT_MEMBER, id) }))
      .filter((x) => x.m?.org === org && x.id !== me);
    const head = members.find((x) => x.m?.rank === "master")?.id;
    const elder = members.find((x) => x.m?.rank === "elder")?.id ?? head;
    if (!elder) throw new Error("sin anciano en la secta");

    // Interno hace un año, un tramo por encima del piso, talento alto y aporte de sobra.
    const year = 365 * 86_400;
    w.truth.set(SECT_MEMBER, me, {
      org,
      rank: "inner",
      since: life.now - year,
      rankSince: life.now - year,
    });
    w.truth.set(SECT_TRIAL, me, {
      org,
      year: 0,
      at: life.now,
      reading: { elements: ["wood"], quality: 0.95 },
      accepted: true,
    });
    w.truth.set(SECT_CONTRIBUTION, me, { org, points: 400, hours: 300, last: life.now });
    const state = w.truth.get(CULTIVATION_STATE, me);
    w.truth.set(CULTIVATION_STATE, me, { ...(state ?? { sensitivity: 1, hours: 0 }), stage: 3 });
    const meet = (other: AgentId) => {
      const here = w.truth.get(LOCATION, me);
      if (!here) throw new Error("sin lugar");
      w.truth.set(LOCATION, other, here);
      for (const id of [me, other]) {
        const body = w.truth.get(BODY_STATE, id);
        if (body) w.truth.set(BODY_STATE, id, { ...body, sleepDebt: 0, fatigue: 0 });
      }
    };
    const ask = (other: AgentId, text: string) => {
      meet(other);
      const report = life.turn(say(me, other, text), 1);
      const reply = report.events.find((e) => e.kind === "action.speak" && e.actors[0] === other);
      return {
        line: (reply?.data as { effect?: { reply: string } } | undefined)?.effect?.reply,
        petition: report.events.find((e) => e.kind === RANK_PETITION_EVENT),
        promoted: report.events.find((e) => e.kind === SECT_PROMOTED_EVENT),
        refused: report.events.find((e) => e.kind === SECT_RANK_REFUSED_EVENT),
      };
    };

    const first = ask(elder, "Anciano, quiero subir al núcleo");
    expect(first.line).toBe("promotion.raise");
    expect(first.refused).toBeUndefined();
    expect(first.promoted?.data).toMatchObject({ org, from: "inner", to: "core", raisedBy: elder });
    // Decide el maestro de la secta si está en la sede.
    const by = (first.promoted?.data as { by?: AgentId } | undefined)?.by;
    if (head) expect(by).toBe(head);
    expect(first.promoted?.actors).toEqual([me, by]);
    expect(first.promoted?.causes).toContainEqual({ kind: "event", event: first.petition?.id });
    expect(w.truth.get(SECT_MEMBER, me)).toMatchObject({ rank: "core", rankSince: life.now });
    expect(w.truth.get(SECT_RANK_RULING, me)).toMatchObject({ rank: "inner", outcome: "promoted" });

    // Recién subido, es pronto para el siguiente.
    expect(ask(elder, "Pido el ascenso").line).toBe("promotion.refuse.too_soon");

    // Un rechazo reciente en este rango: el anciano no lo vuelve a plantear.
    w.truth.set(SECT_MEMBER, me, {
      org,
      rank: "inner",
      since: life.now - year,
      rankSince: life.now - year,
    });
    w.truth.set(SECT_RANK_RULING, me, {
      org,
      rank: "inner",
      at: life.now,
      outcome: "refused",
      refused: "voted_down",
    });
    const again = ask(elder, "Pido el ascenso");
    expect(again.line).toBe("promotion.refuse.waiting");
    expect(again.promoted).toBeUndefined();
    expect(again.refused).toBeUndefined();

    // El maestro del candidato lo plantea por su cuenta solo si cree que llega y está en la sede.
    w.truth.deleteRaw(SECT_RANK_RULING.name, me);
    const review = (raisedBy: AgentId) =>
      reviewRank(
        { truth: w.truth, now: life.now, rng: Rng.root(1), dayTicks: 86_400 },
        {
          who: me,
          org,
          raisedBy,
          cause: first.petition?.id as EventId,
          place: first.petition?.place as PlaceRef,
          onlyIfDue: true,
        },
      );
    expect(review(me).events).toEqual([]);
    expect(review(elder).events.map((e) => e.kind)).toHaveLength(1);
    w.truth.set(SECT_CONTRIBUTION, me, { org, points: 10, hours: 300, last: life.now });
    expect(review(elder).events).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log })).toEqual([]);
  }, 600_000);
});
