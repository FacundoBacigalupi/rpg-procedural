// Pelear con el lobo que bajó (novel3-beasts-fight-strike): se lo ve y se lo nombra («el lobo»)
// cuando está en el hex del personaje y afuera; pegarle es una pelea en que el lobo usa su perfil
// (mordida, instinto, destreza del linaje) y que no abre un caso ni deja enemistad.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, type EntityRef, loadContent } from "../../core/index.ts";
import {
  type ActionPlan,
  BEAST,
  BODY_STATE,
  checkInvariants,
  LOCATION,
  PLACE,
  RELATIONS,
  SECT,
  WILDS,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { knownEntities } from "./known.ts";
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

const DAY = 86400;
const ZONES = new Set([
  "head",
  "neck",
  "chest",
  "abdomen",
  "left_foreleg",
  "right_foreleg",
  "left_hindleg",
  "right_hindleg",
]);

const hit = (actor: AgentId, target: EntityRef): ActionPlan => ({
  actor,
  source: "player",
  root: { kind: "do", verb: "strike", args: [{ role: "target", entity: target }], manner: [] },
  manner: [],
  causes: [{ kind: "state", entity: actor, key: "intent" }],
});

describe("pelear con el lobo (novel3-beasts-fight-strike)", () => {
  const content = loadContent(GAME_CONTENT_KINDS, sources("content"));

  const run = () => {
    const life = Life.create(3, content, { cultivation: true, sectSeatRegion: true });
    const w = life.world;
    const me = life.player;
    const org = w.truth.ids(SECT)[0] as EntityRef;
    const seat = w.truth.get(SECT, org)?.seatPlace as EntityRef;
    const wilds = w.truth.get(WILDS, seat);
    if (!wilds) throw new Error("sin monte en la sede");
    w.truth.set(WILDS, seat, { ...wilds, populations: [{ lineage: "wolf", count: 200 }] });
    const hex = w.truth.get(PLACE, seat)?.hexes[0] as number;
    w.truth.set(LOCATION, me, { hex });
    life.advanceTo(life.now + DAY + 60);
    const wolf = [...w.truth.ids(BEAST)][0] as EntityRef;
    w.truth.set(LOCATION, me, { hex });
    const body = w.truth.get(BODY_STATE, me);
    if (body) w.truth.set(BODY_STATE, me, { ...body, sleepDebt: 0, fatigue: 0, water: 0 });

    const known = knownEntities(w).find((k) => k.ref === wolf);
    const cues = playerView(w, []).self.cues;
    const from = life.now;
    life.turn(hit(me, wolf), 1);
    const fight = w.log
      .all()
      .find((e) => e.kind === "combat.fight" && e.tick >= from && e.actors.includes(wolf as never));
    const after = w.log.all().filter((e) => e.tick >= from);
    return { life, w, me, wolf, known, cues, fight, after };
  };

  it("se lo nombra, se lo ve y pegarle es una pelea con su perfil, sin caso", () => {
    const { w, me, wolf, known, cues, fight, after } = run();
    expect(known).toMatchObject({ kind: "person", present: true });
    expect(known?.names).toContain("el lobo");
    expect(cues).toContain("beast_near");
    expect(fight).toBeDefined();
    const data = fight?.data as {
      outcomes: Record<string, string>;
      hits: { by: string; to: string; zone: string }[];
    };
    expect(data.outcomes[wolf]).toBeDefined();
    expect(data.outcomes[wolf]).not.toBe("yielded");
    for (const h of data.hits.filter((x) => x.to === wolf)) expect(ZONES.has(h.zone)).toBe(true);
    expect(after.some((e) => e.kind.startsWith("law."))).toBe(false);
    expect(w.truth.get(RELATIONS, wolf as unknown as AgentId)).toBeUndefined();
    expect(w.truth.get(BODY_STATE, wolf)).toBeDefined();
    expect(me).toBeDefined();
    expect(checkInvariants({ truth: w.truth, log: w.log })).toEqual([]);
  }, 600_000);

  it("determinista", () => {
    const a = run();
    const b = run();
    expect(b.fight?.data).toEqual(a.fight?.data);
  }, 600_000);
});
