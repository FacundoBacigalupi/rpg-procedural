// Las ofensas entre sectas (novel4-grievance-record): si uno de la secta sabe que uno de la otra le
// pegó a un compañero, la secta lo guarda como ofensa una sola vez y el rencor sube.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, type EntityRef, loadContent } from "../../core/index.ts";
import {
  BODY_STATE,
  checkInvariants,
  ENTITY,
  ENVOY_DAYS,
  ENVOY_WAIT_DAYS,
  GRIEVANCE_RESENTMENT,
  KNOWN_DEEDS,
  MISSION_DAYS,
  ORG_GRIEVANCE_EVENT,
  ORG_GRIEVANCE_MATTER_EVENT,
  ORG_GRIEVANCE_REPLY_EVENT,
  ORG_RELATION,
  orgTie,
  PERSON,
  REPARATION_PENALTY,
  SECT,
  SECT_CONTRIBUTION,
  SECT_GRIEVANCES,
  SECT_MEMBER,
  SECT_MISSION,
  SECT_PRESENCE,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";
import { newGrievances } from "./sect-grievance.ts";
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

const DAY = 86400;

describe("las ofensas entre sectas (novel4-grievance-record)", () => {
  const content = loadContent(GAME_CONTENT_KINDS, sources("content"));

  const setup = () => {
    const l = Life.create(3, content, { cultivation: true, rivalSect: true });
    const t = l.world.truth;
    const [a, b] = t.ids(SECT) as EntityRef[];
    if (!a || !b) throw new Error("sin sectas");
    const alive = (id: AgentId) =>
      t.get(ENTITY, id)?.endedAt === undefined && (t.get(BODY_STATE, id)?.death ?? null) === null;
    const people = (t.ids(PERSON) as AgentId[]).filter((id) => alive(id) && id !== l.player);
    const [knower, victim, by] = people;
    if (!knower || !victim || !by) throw new Error("faltan aldeanos");
    t.set(SECT_MEMBER, knower, { org: a, rank: "outer", since: l.now });
    t.set(SECT_MEMBER, victim, { org: a, rank: "outer", since: l.now });
    t.set(SECT_MEMBER, by, { org: b, rank: "outer", since: l.now });
    const event = l.world.log.all()[0]?.id;
    if (!event) throw new Error("sin eventos");
    t.set(KNOWN_DEEDS, knower, {
      deeds: [{ kind: "assault", by, victim, event, at: l.now, via: "saw" }],
    });
    return { l, t, a, b, knower, victim, by, event };
  };

  it("lo que sabe uno de los suyos se vuelve ofensa contra la otra secta", () => {
    const { t, a, b, knower, event } = setup();
    const found = newGrievances(t);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ org: a, against: b, event, kind: "assault", knower });
  });

  it("la secta la guarda una sola vez, con el rencor y el evento causado por el hecho", () => {
    const { l, t, a, b, event } = setup();
    const before = orgTie(t.get(ORG_RELATION, a), b);
    if (!before) throw new Error("sin relación");
    for (let i = 0; i < 3; i++) l.advanceTo(l.now + DAY);
    const seen = l.world.log.all().filter((e) => e.kind === ORG_GRIEVANCE_EVENT);
    const ours = seen.filter((e) => (e.data as { deed?: string }).deed === event);
    expect(ours).toHaveLength(1);
    expect(ours[0]?.causes).toContainEqual({ kind: "event", event });
    const after = orgTie(t.get(ORG_RELATION, a), b);
    expect(after?.grievances).toContain(event);
    expect(after?.sentiment.resentment ?? 0).toBeGreaterThan(before.sentiment.resentment);
    expect(after?.sentiment.resentment ?? 0).toBeLessThanOrEqual(
      before.sentiment.resentment + GRIEVANCE_RESENTMENT.killing + 1e-9,
    );
    expect(newGrievances(t).filter((g) => g.event === event)).toHaveLength(0);
    expect(checkInvariants({ truth: l.world.truth, log: l.world.log })).toEqual([]);
  });

  it("al día siguiente quien manda la trata: una respuesta, causada por el hecho; determinista", () => {
    const run = () => {
      const s = setup();
      for (let i = 0; i < 3; i++) s.l.advanceTo(s.l.now + DAY);
      return s;
    };
    const { l, t, a, b, event } = run();
    const all = l.world.log.all();
    const recorded = all.find(
      (e) => e.kind === ORG_GRIEVANCE_EVENT && (e.data as { deed?: string }).deed === event,
    );
    const matters = all.filter(
      (e) => e.kind === ORG_GRIEVANCE_MATTER_EVENT && (e.data as { deed?: string }).deed === event,
    );
    expect(matters).toHaveLength(1);
    const matter = matters[0];
    if (!recorded || !matter) throw new Error("sin eventos");
    expect(matter.tick).toBeGreaterThan(recorded.tick);
    expect(matter.causes).toContainEqual({ kind: "event", event });
    const entry = t.get(SECT_GRIEVANCES, a)?.entries.find((e) => e.deed === event);
    expect(entry?.against).toBe(b);
    expect(entry?.response?.choice).toBe((matter.data as { response?: string }).response);
    expect(["demand", "retaliate", "forget"]).toContain(entry?.response?.choice);
    expect(run().t.get(SECT_GRIEVANCES, a)).toEqual(t.get(SECT_GRIEVANCES, a));
    expect(checkInvariants({ truth: l.world.truth, log: l.world.log })).toEqual([]);
  });

  it("la exigencia vuelve después de ir y venir: la otra repara o se niega, y las dos lo sienten (novel4-grievance-act)", () => {
    const { l, t, a, b, by, victim, event, knower } = setup();
    // Ya guardada y tratada: lo que sabe `knower` no la vuelve a abrir.
    t.deleteRaw(KNOWN_DEEDS.name, knower);
    const ours = orgTie(t.get(ORG_RELATION, a), b);
    const theirs = orgTie(t.get(ORG_RELATION, b), a);
    if (!ours || !theirs) throw new Error("sin relación");
    const asked = l.now;
    t.set(SECT_GRIEVANCES, a, {
      entries: [
        {
          deed: event,
          against: b,
          kind: "killing",
          by,
          victim,
          at: asked,
          response: { choice: "demand", at: asked },
        },
      ],
    });
    l.advanceTo(asked + (ENVOY_WAIT_DAYS + ENVOY_DAYS - 2) * DAY);
    expect(t.get(SECT_GRIEVANCES, a)?.entries[0]?.outcome).toBeUndefined();
    l.advanceTo(asked + (ENVOY_WAIT_DAYS + ENVOY_DAYS + 1) * DAY);
    const entry = t.get(SECT_GRIEVANCES, a)?.entries[0];
    const replies = l.world.log.all().filter((e) => e.kind === ORG_GRIEVANCE_REPLY_EVENT);
    expect(replies).toHaveLength(1);
    expect(replies[0]?.causes).toContainEqual({ kind: "event", event });
    const reply = (replies[0]?.data as { reply?: string } | undefined)?.reply;
    const after = orgTie(t.get(ORG_RELATION, a), b);
    const otherAfter = orgTie(t.get(ORG_RELATION, b), a);
    if (reply === "pay") {
      expect(entry?.outcome?.result).toBe("paid");
      expect(after?.sentiment.resentment ?? 1).toBeLessThan(ours.sentiment.resentment);
      expect(otherAfter?.sentiment.resentment ?? 0).toBeGreaterThan(theirs.sentiment.resentment);
    } else {
      expect(entry?.outcome?.result).toBe("refused");
      expect(after?.sentiment.resentment ?? 0).toBeGreaterThan(ours.sentiment.resentment);
    }
    expect(checkInvariants({ truth: l.world.truth, log: l.world.log })).toEqual([]);
  });

  it("si uno de los suyos lleva la exigencia, la ranura no sale; si se le vence, sale desde el plazo (novel4-grievance-envoy-mission)", () => {
    const { l, t, a, b, by, victim, event, knower } = setup();
    t.deleteRaw(KNOWN_DEEDS.name, knower);
    const asked = l.now;
    t.set(SECT_GRIEVANCES, a, {
      entries: [
        {
          deed: event,
          against: b,
          kind: "assault",
          by,
          victim,
          at: asked,
          response: { choice: "demand", at: asked },
        },
      ],
    });
    t.set(SECT_MEMBER, knower, { org: a, rank: "inner", since: l.now });
    const due = asked + MISSION_DAYS.envoy * DAY;
    t.set(SECT_MISSION, knower, {
      org: a,
      kind: "envoy",
      against: b,
      deed: event,
      done: 0,
      points: 30,
      by: victim,
      at: asked,
      due,
    });
    l.advanceTo(asked + (ENVOY_WAIT_DAYS + ENVOY_DAYS + 1) * DAY);
    const carried = t.get(SECT_GRIEVANCES, a)?.entries[0];
    expect(carried?.envoy).toEqual({ who: knower, due });
    expect(carried?.outcome).toBeUndefined();
    l.advanceTo(due + (ENVOY_DAYS - 1) * DAY);
    expect(t.get(SECT_GRIEVANCES, a)?.entries[0]?.outcome).toBeUndefined();
    l.advanceTo(due + (ENVOY_DAYS + 1) * DAY);
    const entry = t.get(SECT_GRIEVANCES, a)?.entries[0];
    expect(["paid", "refused"]).toContain(entry?.outcome?.result);
    expect(l.world.log.all().filter((e) => e.kind === ORG_GRIEVANCE_REPLY_EVENT)).toHaveLength(1);
    expect(checkInvariants({ truth: l.world.truth, log: l.world.log })).toEqual([]);
  });

  it("si al personaje le hicieron la ofensa y está en la sede, se entera de lo que decidió su secta (novel4-grievance-player)", () => {
    const { l, t, a, knower, by, event } = setup();
    t.set(SECT_MEMBER, l.player, { org: a, rank: "outer", since: l.now });
    t.set(KNOWN_DEEDS, knower, {
      deeds: [{ kind: "assault", by, victim: l.player, event, at: l.now, via: "saw" }],
    });
    const from = l.now;
    for (let i = 0; i < 3; i++) l.advanceTo(l.now + DAY);
    const matter = l.world.log.all().find((e) => e.kind === ORG_GRIEVANCE_MATTER_EVENT);
    const response = (matter?.data as { response?: string } | undefined)?.response;
    const expected = {
      demand: "grievance_demand",
      retaliate: "grievance_retaliate",
      forget: "grievance_forgotten",
    }[response as "demand"];
    const cues = playerView(l.world, [], { heardSince: from }).self.cues;
    expect(cues).toContain(expected);
    // Afuera de la sede no se entera.
    t.set(SECT_PRESENCE, l.player, { org: a, away: true, since: l.now });
    expect(playerView(l.world, [], { heardSince: from }).self.cues).not.toContain(expected);
  });

  it("si la hizo el personaje y su secta repara, se lo cobra del aporte; si se niega, lo cubre (novel4-grievance-player)", () => {
    const { l, t, a, b, victim, event, knower } = setup();
    t.deleteRaw(KNOWN_DEEDS.name, knower);
    t.set(SECT_MEMBER, l.player, { org: b, rank: "outer", since: l.now });
    t.set(SECT_CONTRIBUTION, l.player, { org: b, points: 100, hours: 0, last: l.now });
    const asked = l.now;
    t.set(SECT_GRIEVANCES, a, {
      entries: [
        {
          deed: event,
          against: b,
          kind: "killing",
          by: l.player,
          victim,
          at: asked,
          response: { choice: "demand", at: asked },
        },
      ],
    });
    l.advanceTo(asked + (ENVOY_WAIT_DAYS + ENVOY_DAYS + 1) * DAY);
    const reply = l.world.log.all().find((e) => e.kind === ORG_GRIEVANCE_REPLY_EVENT);
    const d = reply?.data as { reply?: string; penalty?: number } | undefined;
    const cues = playerView(l.world, [], { heardSince: asked }).self.cues;
    if (d?.reply === "pay") {
      expect(d.penalty).toBe(REPARATION_PENALTY.killing);
      expect(t.get(SECT_CONTRIBUTION, l.player)?.points).toBe(100 - REPARATION_PENALTY.killing);
      expect(cues).toContain("grievance_punished");
    } else {
      expect(t.get(SECT_CONTRIBUTION, l.player)?.points).toBe(100);
      expect(cues).toContain("grievance_shielded");
    }
  });

  it("de un compañero muerto, la agresión cuenta como muerte", () => {
    const { t, victim } = setup();
    const body = t.get(BODY_STATE, victim);
    if (!body) throw new Error("sin cuerpo");
    t.set(BODY_STATE, victim, { ...body, death: { at: 0, cause: "test" } } as never);
    expect(newGrievances(t)[0]?.kind).toBe("killing");
  });
});
