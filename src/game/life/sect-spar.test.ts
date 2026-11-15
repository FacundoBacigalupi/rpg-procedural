// La práctica de la sede (novel3-spar-npc): los discípulos que viven en la sede practican entre
// ellos a la hora de práctica, con quien conocen, con toques frenados y sin dejar a nadie a merced.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  compareStrings,
  type EntityRef,
  type Event,
  type EventId,
  HOUR,
  loadContent,
} from "../../core/index.ts";
import {
  BODY_STATE,
  checkInvariants,
  DUEL,
  type DuelRule,
  LOCATION,
  PLACE,
  SECT,
  SECT_MEMBER,
  YIELDED,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";
import { SECT_HALL } from "./sect-hall.ts";
import { DUEL_PLATFORM_EVENT, ROUTINE_SPAR_EVENT } from "./sect-spar.ts";

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}

describe("la práctica de la sede (novel3-spar-npc)", () => {
  const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
  const options = { cultivation: true, sectSeatRegion: true } as const;
  const run = (days: number) => {
    const l = Life.create(3, content, options);
    const w = l.world;
    const org = w.truth.ids(SECT)[0] as EntityRef;
    const s = w.truth.get(SECT, org);
    if (!s) throw new Error("sin secta");
    const goal = w.truth.get(PLACE, s.seatPlace)?.hexes[0] as number;
    w.truth.set(LOCATION, l.player, { hex: goal });
    l.advanceTo(l.now + 2 * HOUR);
    const people = new Set<string>(
      (w.truth.get(SECT_HALL, org)?.people ?? []).map((x) => x.person as string),
    );
    l.advanceTo(l.now + days * w.clock.day);
    return { l, w, people };
  };

  it("practican de a dos con quien conocen, sin peleas de verdad ni rendidos; determinista", () => {
    const { l, w, people } = run(6);
    const theirs = (kind: string) =>
      w.log.all().filter((e) => e.kind === kind && e.actors.some((a) => people.has(a as string)));
    expect(theirs(ROUTINE_SPAR_EVENT).length).toBeGreaterThan(0);
    const spars = theirs("combat.spar");
    expect(spars.length).toBeGreaterThan(0);
    for (const e of spars) {
      expect(e.causes[0]?.kind).toBe("event");
      expect(e.actors.every((a) => people.has(a as string))).toBe(true);
    }
    expect(theirs("combat.fight")).toEqual([]);
    for (const p of people) {
      expect(w.truth.has(YIELDED, p as EntityRef)).toBe(false);
      const b = w.truth.get(BODY_STATE, p as EntityRef);
      expect(b?.death ?? null).toBeNull();
    }
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log })).toEqual([]);
    const twin = run(6);
    expect(twin.l.hash().total).toBe(l.hash().total);
  });
});

describe("los discípulos pelean sus duelos pactados (novel4-duel-npc)", () => {
  const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
  const options = { cultivation: true, sectSeatRegion: true } as const;
  const run = (rule: DuelRule, ranks: readonly string[]) => {
    const l = Life.create(3, content, options);
    const w = l.world;
    const org = w.truth.ids(SECT)[0] as EntityRef;
    const s = w.truth.get(SECT, org);
    if (!s) throw new Error("sin secta");
    const goal = w.truth.get(PLACE, s.seatPlace)?.hexes[0] as number;
    w.truth.set(LOCATION, l.player, { hex: goal });
    l.advanceTo(l.now + 2 * HOUR);
    const people = (w.truth.ids(SECT_MEMBER) as AgentId[])
      .filter((p) => {
        const m = w.truth.get(SECT_MEMBER, p);
        return m?.org === org && ranks.includes(m.rank) && w.truth.get(LOCATION, p)?.hex === goal;
      })
      .sort(compareStrings);
    const [a, b] = people;
    if (!a || !b) throw new Error("faltan discípulos");
    const event = w.log.all()[0]?.id as EventId;
    const until = l.now + 2 * w.clock.day;
    w.truth.set(DUEL, a, { with: b, rule, challenger: a, at: l.now, until, event });
    w.truth.set(DUEL, b, { with: a, rule, challenger: a, at: l.now, until, event });
    l.advanceTo(l.now + 2 * w.clock.day);
    const fights = w.log
      .all()
      .filter((e) => e.kind === "combat.fight" && e.actors[0] === a && e.actors[1] === b);
    return { l, w, a, b, fights };
  };

  it("a rendirse, en la plataforma a la hora de práctica; se cierra el duelo; determinista", () => {
    const { l, w, a, b, fights } = run("yield", ["inner", "core"]);
    expect(fights.length).toBe(1);
    const f = fights[0] as Event;
    expect((f.data as { duel?: { rule: string; kept: boolean } }).duel).toMatchObject({
      rule: "yield",
      kept: true,
    });
    const up = w.log.all().find((e) => e.kind === DUEL_PLATFORM_EVENT);
    expect(up?.actors.slice(0, 2)).toEqual([a, b]);
    expect(f.causes[0]).toEqual({ kind: "event", event: expect.any(String) });
    expect(w.truth.has(DUEL, a)).toBe(false);
    expect(w.truth.has(DUEL, b)).toBe(false);
    expect(checkInvariants({ truth: w.truth, log: w.log })).toEqual([]);
    expect(run("yield", ["inner", "core"]).l.hash().total).toBe(l.hash().total);
  });

  it("a primera sangre también", () => {
    const { fights } = run("first_blood", ["inner", "core"]);
    expect(fights.length).toBe(1);
    expect(((fights[0] as Event).data as { duel?: { rule: string } }).duel?.rule).toBe(
      "first_blood",
    );
  });

  it("a muerte solo se pelea con un anciano que mira, y entonces se respeta", () => {
    const { w, fights } = run("death", ["inner", "core"]);
    expect(fights.length).toBe(1);
    for (const f of fights) {
      const duel = (f.data as { duel?: { kept: boolean; platform?: string } }).duel;
      expect(duel?.platform).toBeDefined();
      expect(duel?.kept).toBe(true);
      const up = w.log.all().find((e) => e.kind === DUEL_PLATFORM_EVENT);
      expect(up?.actors.length).toBe(3);
    }
  });
});
