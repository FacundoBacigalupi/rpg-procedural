// Pedir el ascenso hablando (novel2-rank-ask): el personaje le pide a un anciano de su secta que lo
// suba; el anciano mira los pisos del paso (tiempo en el rango, tramo, aporte) y su trato, y si cumple
// plantea el asunto (`cultivation.rank_petition`); si no, dice por qué. Quien no es anciano no plantea.

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
  CULTIVATION_STATE,
  checkInvariants,
  LOCATION,
  normalize,
  PLACE,
  RANK_PETITION_EVENT,
  SECT,
  SECT_CONTRIBUTION,
  SECT_MEMBER,
  SECT_TRIAL,
  understand,
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

describe("pedir el ascenso (novel2-rank-ask)", () => {
  it("se entiende como su propio acto, aunque nombre a los discípulos", () => {
    for (const text of [
      "Anciano, pido el ascenso",
      "Quiero subir al núcleo",
      "Quisiera ser discípulo del núcleo",
      "¿Me ascendería?",
      "Quiero ser anciano",
    ]) {
      expect(understand(text, lex).kind, normalize(text)).toBe("promotion");
    }
    expect(understand("Tomame como discípulo", lex).kind).toBe("apprentice");
  });

  it("el anciano lo plantea si cumple; si no, dice qué falta; quien no es anciano, no", () => {
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
    const elder = members.find((x) => x.m?.rank === "elder" || x.m?.rank === "master")?.id;
    const outer = members.find((x) => x.m?.rank === "outer" || x.m?.rank === "inner")?.id;
    if (!elder || !outer) throw new Error("sin anciano o sin discípulo en la secta");

    // Interno hace un año, en el segundo tramo y con aporte de sobra.
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
      reading: { elements: ["wood"], quality: 0.7 },
      accepted: true,
    });
    w.truth.set(SECT_CONTRIBUTION, me, { org, points: 200, hours: 300, last: life.now });
    const state = w.truth.get(CULTIVATION_STATE, me);
    w.truth.set(CULTIVATION_STATE, me, {
      ...(state ?? { sensitivity: 1, hours: 0 }),
      stage: 2,
    });
    const meet = (other: AgentId) => {
      const here = w.truth.get(LOCATION, me);
      if (!here) throw new Error("sin lugar");
      w.truth.set(LOCATION, other, here);
      for (const id of [me, other]) {
        const body = w.truth.get(BODY_STATE, id);
        if (body) w.truth.set(BODY_STATE, id, { ...body, sleepDebt: 0, fatigue: 0 });
      }
    };
    const replyOf = (other: AgentId, text: string) => {
      meet(other);
      const report = life.turn(say(me, other, text), 1);
      const reply = report.events.find((e) => e.kind === "action.speak" && e.actors[0] === other);
      const petition = report.events.find((e) => e.kind === RANK_PETITION_EVENT);
      return {
        line: (reply?.data as { effect?: { reply: string } } | undefined)?.effect?.reply,
        petition: petition?.data as { to?: string; refused?: string } | undefined,
        actors: petition?.actors,
      };
    };

    // Quien no es anciano no plantea ascensos.
    const no = replyOf(outer, "Pido el ascenso");
    expect(no.line).toBe("promotion.no");
    expect(no.petition).toBeUndefined();

    // El anciano lo plantea: cumple con todo.
    const raised = replyOf(elder, "Anciano, quiero subir al núcleo");
    expect(raised.line).toBe("promotion.raise");
    expect(raised.petition).toMatchObject({ to: "core" });
    expect(raised.petition?.refused).toBeUndefined();
    expect(raised.actors).toEqual([me, elder]);

    // Con poco aporte, dice qué falta y no lo plantea.
    w.truth.set(SECT_CONTRIBUTION, me, { org, points: 10, hours: 300, last: life.now });
    const short = replyOf(elder, "Pido el ascenso");
    expect(short.line).toBe("promotion.refuse.few_points");
    expect(short.petition?.refused).toBe("few_points");
    expect(w.truth.get(SECT_MEMBER, me)?.rank).toBe("inner");
    expect(checkInvariants({ truth: w.truth, log: w.log })).toEqual([]);
  }, 600_000);
});
