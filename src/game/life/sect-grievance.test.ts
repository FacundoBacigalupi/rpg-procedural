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
  GRIEVANCE_RESENTMENT,
  KNOWN_DEEDS,
  ORG_GRIEVANCE_EVENT,
  ORG_RELATION,
  orgTie,
  PERSON,
  SECT,
  SECT_MEMBER,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";
import { newGrievances } from "./sect-grievance.ts";

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

  it("de un compañero muerto, la agresión cuenta como muerte", () => {
    const { t, victim } = setup();
    const body = t.get(BODY_STATE, victim);
    if (!body) throw new Error("sin cuerpo");
    t.set(BODY_STATE, victim, { ...body, death: { at: 0, cause: "test" } } as never);
    expect(newGrievances(t)[0]?.kind).toBe("killing");
  });
});
