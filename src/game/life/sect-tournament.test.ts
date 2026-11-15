// El torneo entre sectas (novel4-tournament-call): las rivales lo convocan y, si no se hace, se pierde.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, type EntityRef, loadContent } from "../../core/index.ts";
import {
  checkInvariants,
  ORG_RELATION,
  ORG_TOURNAMENT_CALLED_EVENT,
  ORG_TOURNAMENT_LAPSED_EVENT,
  SECT,
  SECT_TOURNAMENT,
  TOURNAMENT_LATE_DAYS,
  TOURNAMENT_NOTICE_DAYS,
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

const DAY = 86400;

describe("el torneo entre sectas (novel4-tournament-call)", () => {
  const content = loadContent(GAME_CONTENT_KINDS, sources("content"));

  const setup = (resentment: number) => {
    const l = Life.create(3, content, { cultivation: true, rivalSect: true });
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
});
