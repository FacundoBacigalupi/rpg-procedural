// La cueva de la sede (novel-sect-cave-pass): entran los internos y los de más rango; el externo
// solo con un pase de horas, que se gastan meditando adentro. Sin rango ni pase lo paran en la
// entrada y sabe por qué.

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
  caveBarred,
  checkInvariants,
  type IntentDraft,
  LOCATION,
  PLACE,
  planFromDraft,
  SECT,
  SECT_CAVE_PASS,
  SECT_CAVE_PASS_SPENT_EVENT,
  SECT_MEMBER,
  sectSpaceKey,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { knownEntities, knownSpaces } from "./known.ts";
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

describe("la cueva de la sede", () => {
  it("al externo sin pase lo paran; con pase entra y medita hasta gastarlo", () => {
    const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
    const life = Life.create(3, content, { cultivation: true, sectSeatRegion: true });
    const w = life.world;
    const me = life.player;
    const ref = me as unknown as EntityRef;
    const org = w.truth.ids(SECT)[0] as EntityRef;
    const sect = w.truth.get(SECT, org);
    if (!sect) throw new Error("sin secta");
    const hex = w.truth.get(PLACE, sect.seatPlace)?.hexes[0] as number;
    const gate = sectSpaceKey(sect.seatPlace, "gate");
    const cave = sectSpaceKey(sect.seatPlace, "cave");
    const rested = () => {
      const body = w.truth.get(BODY_STATE, me);
      if (body) w.truth.set(BODY_STATE, me, { ...body, sleepDebt: 0, fatigue: 0, water: 0 });
    };
    const toCave = (): ActionPlan => {
      const known = knownEntities(w);
      const made = planFromDraft(
        {
          kind: "act",
          plan: {
            kind: "do",
            verb: "move",
            args: [{ role: "to", ref: { text: "la cueva", kind: "place", features: [] } }],
          },
        } as IntentDraft,
        {
          actor: me,
          source: "player",
          catalog: w.catalog,
          known,
          clock: w.clock,
          causes: [{ kind: "state", entity: me, key: "intent" }],
          here: hex,
          spaces: knownSpaces(w, known),
        },
      );
      if (made.kind !== "plan") throw new Error(`la cueva: ${made.kind}`);
      return made.plan;
    };

    // Quién entra: el de afuera no; el externo sin pase no; el interno sí; el externo con pase sí.
    expect(caveBarred(w.truth, ref, gate)).toBe(false);
    expect(caveBarred(w.truth, ref, cave)).toBe(true);
    w.truth.set(SECT_MEMBER, me, { org, rank: "outer", since: life.now });
    expect(caveBarred(w.truth, ref, cave)).toBe(true);
    w.truth.set(SECT_MEMBER, me, { org, rank: "inner", since: life.now });
    expect(caveBarred(w.truth, ref, cave)).toBe(false);
    w.truth.set(SECT_MEMBER, me, { org, rank: "outer", since: life.now });
    w.truth.set(SECT_CAVE_PASS, me, { org, hours: 2, since: life.now });
    expect(caveBarred(w.truth, ref, cave)).toBe(false);
    w.truth.set(SECT_CAVE_PASS, me, { org, hours: 0, since: life.now });
    expect(caveBarred(w.truth, ref, cave)).toBe(true);
    w.truth.deleteRaw(SECT_CAVE_PASS.name, ref);

    // Sin pase, desde el portón: lo paran y lo sabe.
    w.truth.set(LOCATION, me, { hex, space: gate });
    rested();
    const stopped = life.turn(toCave(), 1);
    const moved = stopped.events.find((e) => e.kind === "action.move" && e.actors[0] === me);
    expect(moved?.outcome).toBe("failure");
    expect((moved?.data as { failure?: string } | undefined)?.failure).toBe("refused");
    expect(w.truth.get(LOCATION, me)).toEqual({ hex, space: gate });

    // Con dos horas de pase: entra, medita tres y el pase se gasta.
    w.truth.set(SECT_CAVE_PASS, me, { org, hours: 2, since: life.now });
    rested();
    life.turn(toCave(), 1);
    expect(w.truth.get(LOCATION, me)).toEqual({ hex, space: cave });
    rested();
    const from = life.now;
    const sit = (hours: number): ActionPlan => ({
      actor: me as AgentId,
      source: "player",
      root: {
        kind: "do",
        verb: "meditate",
        args: [{ role: "for", seconds: hours * HOUR }],
        manner: [],
      },
      manner: [],
      causes: [{ kind: "state", entity: me, key: "intent" }],
    });
    life.turn(sit(3), 1);
    expect(w.truth.has(SECT_CAVE_PASS, me)).toBe(false);
    const spent = w.log
      .all()
      .filter((e) => e.kind === SECT_CAVE_PASS_SPENT_EVENT && e.actors[0] === me);
    expect(spent.length).toBe(1);
    expect(playerView(w, [], { heardSince: from }).self.cues).toContain("cave_pass_spent");
    expect(checkInvariants({ truth: w.truth, log: w.log })).toEqual([]);
  }, 180_000);
});
