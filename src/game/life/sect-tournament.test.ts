// El torneo entre sectas (novel4-tournament-call): las rivales lo convocan y, si no se hace, se pierde.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, type EntityRef, loadContent } from "../../core/index.ts";
import {
  BODY_STATE,
  checkInvariants,
  ENTITY,
  LOCATION,
  ORG_RELATION,
  ORG_TOURNAMENT_CALLED_EVENT,
  ORG_TOURNAMENT_HELD_EVENT,
  ORG_TOURNAMENT_LAPSED_EVENT,
  PERSON,
  PLACE,
  SECT,
  SECT_MEMBER,
  SECT_TOURNAMENT,
  TOURNAMENT_LATE_DAYS,
  TOURNAMENT_NOTICE_DAYS,
  TOURNAMENT_RETURN_DAYS,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { PLAN_STATE } from "./act.ts";
import { DUEL_SETTLED_EVENT } from "./duels.ts";
import { Life } from "./life.ts";
import { NPC_JOURNEY } from "./npc-verbs.ts";
import { atSeat } from "./sect-grievance.ts";
import { tournamentDuty } from "./sect-tournament.ts";
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
const YEAR = 365 * DAY;

describe("el torneo entre sectas (novel4-tournament-call)", () => {
  const content = loadContent(GAME_CONTENT_KINDS, sources("content"));

  const setup = (resentment: number, journeys = false) => {
    const l = Life.create(
      3,
      content,
      journeys
        ? {
            cultivation: true,
            rivalSect: true,
            npcJourneyDays: 30,
            npcVerbs: ["move"],
            npcMove: true,
            npcTransit: true,
            sectSeatRegion: true,
          }
        : { cultivation: true, rivalSect: true },
    );
    const t = l.world.truth;
    const [a, b] = ([...t.ids(SECT)] as EntityRef[]).sort();
    if (!a || !b) throw new Error("sin sectas");
    for (const [x, y] of [
      [a, b],
      [b, a],
    ] as const) {
      const rel = t.get(ORG_RELATION, x);
      const tie = rel?.toward[y];
      if (!rel || !tie) throw new Error("sin relación");
      t.set(ORG_RELATION, x, {
        toward: {
          ...rel.toward,
          [y]: { ...tie, sentiment: { ...tie.sentiment, resentment, fear: 0.1 } },
        },
      });
    }
    return { l, t, a, b };
  };

  it("las rivales lo convocan en la sede de la más vieja y, sin hacerse, se pierde", () => {
    const { l, t, a, b } = setup(0.1);
    const from = l.now;
    l.advanceTo(from + DAY);
    const called = l.world.log
      .all()
      .filter((e) => e.kind === ORG_TOURNAMENT_CALLED_EVENT && e.tick >= from);
    expect(called).toHaveLength(1);
    const sa = t.get(SECT, a);
    const sb = t.get(SECT, b);
    if (!sa || !sb) throw new Error("sin sectas");
    const older = sa.founded <= sb.founded ? a : b;
    const rec = t.get(SECT_TOURNAMENT, a)?.with[b];
    expect(rec).toMatchObject({ host: older, status: "called", called: called[0]?.id });
    expect(called[0]?.data).toMatchObject({ host: older, guest: older === a ? b : a });
    const at = rec?.at ?? 0;
    expect(at - (called[0]?.tick ?? 0)).toBe(TOURNAMENT_NOTICE_DAYS * DAY);
    l.advanceTo(at + TOURNAMENT_LATE_DAYS * DAY + DAY);
    const lapsed = l.world.log.all().filter((e) => e.kind === ORG_TOURNAMENT_LAPSED_EVENT);
    expect(lapsed).toHaveLength(1);
    expect(lapsed[0]?.causes).toContainEqual({ kind: "event", event: called[0]?.id });
    expect(t.get(SECT_TOURNAMENT, a)?.with[b]).toMatchObject({
      status: "lapsed",
      closedBy: lapsed[0]?.id,
    });
    // Perdido, no se vuelve a convocar hasta la espera.
    expect(
      l.world.log.all().filter((e) => e.kind === ORG_TOURNAMENT_CALLED_EVENT && e.tick >= from),
    ).toHaveLength(1);
    expect(checkInvariants({ truth: l.world.truth, log: l.world.log })).toEqual([]);
  });

  it("con mucho rencor no se convoca", () => {
    const { l } = setup(0.9);
    const from = l.now;
    l.advanceTo(from + 3 * DAY);
    expect(
      l.world.log.all().filter((e) => e.kind === ORG_TOURNAMENT_CALLED_EVENT && e.tick >= from),
    ).toHaveLength(0);
  });

  it("la visitante manda a uno de cuerpo: va, pelea en la plataforma y vuelve (delegation, bouts)", () => {
    const { l, t, a, b } = setup(0.1, true);
    const sa = t.get(SECT, a);
    const sb = t.get(SECT, b);
    if (!sa || !sb) throw new Error("sin sectas");
    const host = sa.founded <= sb.founded ? a : b;
    const guest = host === a ? b : a;
    const alive = (id: AgentId) =>
      t.get(ENTITY, id)?.endedAt === undefined && (t.get(BODY_STATE, id)?.death ?? null) === null;
    const who = (t.ids(PERSON) as AgentId[]).find(
      (id) =>
        alive(id) &&
        id !== l.player &&
        t.get(LOCATION, id) !== undefined &&
        l.now - (t.get(PERSON, id)?.born ?? l.now) > 20 * YEAR &&
        l.now - (t.get(PERSON, id)?.born ?? l.now) < 40 * YEAR,
    );
    if (!who) throw new Error("sin aldeanos");
    // El único de rango de la visitante.
    for (const id of [...t.ids(SECT_MEMBER)] as AgentId[]) {
      const m = t.get(SECT_MEMBER, id);
      if (m?.org === guest && (m.rank === "inner" || m.rank === "elder"))
        t.set(SECT_MEMBER, id, { ...m, rank: "outer" });
    }
    t.set(SECT_MEMBER, who, { org: guest, rank: "inner", since: l.now });
    const seatHex = (org: EntityRef) =>
      t.get(PLACE, t.get(SECT, org)?.seatPlace as EntityRef)?.hexes[0] as number;
    const home = () => {
      t.set(LOCATION, who, { hex: seatHex(guest) });
      for (const table of [TRANSIT, NPC_JOURNEY, PLAN_STATE]) t.deleteRaw(table.name, who);
    };
    home();
    const body0 = t.get(BODY_STATE, who);
    if (!body0) throw new Error("sin cuerpo");
    const fed = () => t.set(BODY_STATE, who, { ...body0, updatedAt: l.now });
    fed();
    l.advanceTo(l.now + DAY);
    const called = l.world.log.all().find((e) => e.kind === ORG_TOURNAMENT_CALLED_EVENT);
    expect(called?.data).toMatchObject({ host, guest, delegates: [who] });
    const [keeper, other] = a < b ? [a, b] : [b, a];
    const rec = t.get(SECT_TOURNAMENT, keeper)?.with[other];
    if (!rec) throw new Error("sin torneo");
    expect(rec.delegates).toEqual([who]);
    // El aldeano hecho discípulo tiene la casa en la aldea: sale de la sede, sin lo que ya andaba.
    home();
    // Sale apenas lo nombran: el aviso es lo que tarda el viaje.
    expect(
      tournamentDuty(t, who, l.now, DAY, { map: l.world.map, spaces: l.world.spaces }),
    ).toEqual({ kind: "go", place: t.get(SECT, host)?.seatPlace });
    while (!atSeat(t, who, host) && l.now < rec.at) {
      fed();
      l.advanceTo(l.now + DAY);
    }
    expect(atSeat(t, who, host)).toBe(true);
    // Se queda mientras siga convocado.
    for (let d = 0; d < 2 && l.now < rec.at; d++) {
      fed();
      l.advanceTo(l.now + DAY);
      expect(atSeat(t, who, host)).toBe(true);
    }
    // La gente de la sede de la casa no está materializada sin el personaje: uno de la aldea hecho
    // discípulo interno de la que lo pone, en su sede el día del torneo.
    const champ = (t.ids(PERSON) as AgentId[]).find(
      (id) =>
        id !== who &&
        alive(id) &&
        id !== l.player &&
        t.get(LOCATION, id) !== undefined &&
        l.now - (t.get(PERSON, id)?.born ?? l.now) > 20 * YEAR &&
        l.now - (t.get(PERSON, id)?.born ?? l.now) < 40 * YEAR,
    );
    if (!champ) throw new Error("sin aldeanos");
    t.set(SECT_MEMBER, champ, { org: host, rank: "inner", since: l.now });
    const champBody = t.get(BODY_STATE, champ);
    if (!champBody) throw new Error("sin cuerpo");
    while (l.now < rec.at) {
      fed();
      l.advanceTo(Math.min(rec.at, l.now + DAY));
    }
    expect(atSeat(t, who, host)).toBe(true);
    // El día del torneo pelea en la plataforma con el de la casa y el torneo queda hecho.
    while (
      t.get(SECT_TOURNAMENT, keeper)?.with[other]?.status === "called" &&
      l.now < rec.at + TOURNAMENT_LATE_DAYS * DAY
    ) {
      fed();
      t.set(BODY_STATE, champ, { ...champBody, updatedAt: l.now });
      t.set(LOCATION, champ, { hex: seatHex(host) });
      for (const table of [TRANSIT, NPC_JOURNEY, PLAN_STATE]) t.deleteRaw(table.name, champ);
      l.advanceTo(l.now + 3600);
    }
    const held = l.world.log.all().find((e) => e.kind === ORG_TOURNAMENT_HELD_EVENT);
    if (!held) throw new Error("sin torneo hecho");
    expect(t.get(SECT_TOURNAMENT, keeper)?.with[other]).toMatchObject({
      status: "held",
      closedBy: held.id,
    });
    const bouts = (held.data as { bouts: { host: AgentId; guest: AgentId; winner?: AgentId }[] })
      .bouts;
    expect(bouts).toHaveLength(1);
    expect(bouts[0]).toMatchObject({ host: champ, guest: who });
    const fight = l.world.log
      .all()
      .find(
        (e) =>
          e.kind === "combat.fight" &&
          held.causes.some((c) => c.kind === "event" && c.event === e.id),
      );
    expect(fight?.actors).toEqual([champ, who]);
    expect((fight?.data as { duel?: { rule?: string } } | undefined)?.duel?.rule).toBe("yield");
    // `life.duels` lo cierra: el que ganó sale con cara y su secta pesa en la otra.
    if (bouts[0]?.winner && fight) {
      expect(
        l.world.log
          .all()
          .some(
            (e) =>
              e.kind === DUEL_SETTLED_EVENT &&
              e.causes.some((c) => c.kind === "event" && c.event === fight.id),
          ),
      ).toBe(true);
    }
    // Cerrado, vuelve.
    const now = l.now;
    // Vuelve por el camino; el que vive en la aldea sigue de la sede a su casa.
    while (
      tournamentDuty(t, who, l.now, DAY, { map: l.world.map, spaces: l.world.spaces }) !==
        undefined &&
      l.now < now + TOURNAMENT_RETURN_DAYS * DAY
    ) {
      fed();
      l.advanceTo(l.now + DAY);
    }
    expect(l.now).toBeLessThan(now + TOURNAMENT_RETURN_DAYS * DAY);
    expect(atSeat(t, who, host)).toBe(false);
    expect(checkInvariants({ truth: l.world.truth, log: l.world.log })).toEqual([]);
  });
});
