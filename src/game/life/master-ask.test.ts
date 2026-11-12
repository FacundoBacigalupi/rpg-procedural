// Pedir maestro hablando (novel2-master-ask): el personaje le pide a un anciano de su secta que lo
// tome como discípulo; el anciano pesa lo que sabe de él (`masterAccepts`) y, si dice que sí, el
// vínculo queda en el personaje. Ya con maestro, otro no lo toma; y quien no es anciano no toma a nadie.

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
  MASTER_OF,
  MASTER_TAKEN_EVENT,
  normalize,
  PLACE,
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

describe("pedir maestro (novel2-master-ask)", () => {
  it("se entiende como su propio acto", () => {
    for (const text of [
      "Anciano, tomame como discípulo",
      "¿Me aceptaría como su discípula?",
      "Quiero ser su discípulo",
      "Le ruego que sea mi maestro",
    ]) {
      expect(understand(text, lex).kind, normalize(text)).toBe("apprentice");
    }
    expect(understand("¿Cuántos discípulos hay en la secta?", lex).kind).not.toBe("apprentice");
  });

  it("el anciano lo toma si vale; con maestro ya no; quien no es anciano, no", () => {
    const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
    const life = Life.create(3, content, { cultivation: true, sectSeatRegion: true });
    const w = life.world;
    const me = life.player;
    const org = w.truth.ids(SECT)[0] as EntityRef;
    const sect = w.truth.get(SECT, org);
    if (!sect) throw new Error("sin secta");
    // En la sede: la gente de la secta se materializa al llegar.
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

    // Un discípulo interno con buen talento medido, algo de cultivo y aporte.
    w.truth.set(SECT_MEMBER, me, { org, rank: "inner", since: life.now });
    w.truth.set(SECT_TRIAL, me, {
      org,
      year: 0,
      at: life.now,
      reading: { elements: ["wood"], quality: 0.9 },
      accepted: true,
    });
    w.truth.set(SECT_CONTRIBUTION, me, { org, points: 80, hours: 40, last: life.now });
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
      const taken = report.events.find((e) => e.kind === MASTER_TAKEN_EVENT);
      return {
        line: (reply?.data as { effect?: { reply: string } } | undefined)?.effect?.reply,
        taken,
      };
    };

    // Quien no es anciano no toma discípulos.
    expect(replyOf(outer, "Tomame como discípulo").line).toBe("apprentice.no");
    expect(w.truth.has(MASTER_OF, me)).toBe(false);

    // El anciano lo toma.
    const first = replyOf(elder, "Anciano, tomame como discípulo");
    expect(first.line).toBe("apprentice.accept");
    expect(w.truth.get(MASTER_OF, me)).toMatchObject({ master: elder, org });
    expect(first.taken?.actors).toEqual([me, elder]);
    expect((first.taken?.data as { refused?: string } | undefined)?.refused).toBeUndefined();

    // Ya con maestro, no le saca el discípulo a nadie (ni él mismo lo vuelve a tomar).
    const again = replyOf(elder, "Anciano, tomame como discípulo");
    expect(again.line).toBe("apprentice.refuse.has_master");
    expect((again.taken?.data as { refused?: string } | undefined)?.refused).toBe("has_master");
    expect(checkInvariants({ truth: w.truth, log: w.log })).toEqual([]);
  }, 600_000);
});
